/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import {marked} from 'marked';
import OpenAI from 'openai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const openai = new OpenAI({
  apiKey: GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  dangerouslyAllowBrowser: true,
});

const chatHistory = document.getElementById('chat-history') as HTMLElement;
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const sendButton = document.getElementById('send-button') as HTMLButtonElement;

type Message = { role: 'system' | 'user' | 'assistant', content: string };

const messages: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.' }
];

function appendMessage(role: 'user' | 'assistant', content: string): HTMLElement {
  const messageDiv = document.createElement('div');
  messageDiv.className = `flex w-full ${role === 'user' ? 'justify-end' : 'justify-start'}`;
  
  const bubble = document.createElement('div');
  bubble.className = `max-w-3xl rounded-2xl px-5 py-4 shadow-sm ${
    role === 'user' 
      ? 'bg-blue-600 text-white' 
      : 'bg-white border border-gray-200 text-gray-800 markdown-body'
  }`;
  
  if (role === 'user') {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = content; // Will be parsed markdown
  }
  
  messageDiv.appendChild(bubble);
  chatHistory.appendChild(messageDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  
  return bubble;
}

async function handleStream(stream: AsyncIterable<any>, bubble: HTMLElement) {
  let fullContent = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    fullContent += content;
    bubble.innerHTML = await marked.parse(fullContent);
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }
  return fullContent;
}

async function main() {
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const userText = chatInput.value.trim();
    if (!userText) return;
    
    // Add user message to UI and history
    appendMessage('user', userText);
    messages.push({ role: 'user', content: userText });
    
    // Clear input and disable form
    chatInput.value = '';
    chatInput.disabled = true;
    sendButton.disabled = true;
    
    // Create empty bubble for assistant response
    const assistantBubble = appendMessage('assistant', '<span class="animate-pulse">Thinking...</span>');
    
    try {
      const stream = await openai.chat.completions.create({
        model: 'models/gemini-2.5-flash',
        messages: messages,
        stream: true,
      });
      
      const fullResponse = await handleStream(stream, assistantBubble);
      messages.push({ role: 'assistant', content: fullResponse });
    } catch (error: any) {
      console.error('Chat API Error:', error);
      
      let errorMessage = 'An unexpected error occurred. Please try again later.';
      
      if (error?.status === 401 || error?.message?.includes('API key')) {
        errorMessage = 'Authentication error: Invalid or missing API key. Please check your configuration.';
      } else if (error?.status === 429) {
        errorMessage = 'Rate limit exceeded: Please wait a moment before sending another message.';
      } else if (error?.status >= 500) {
        errorMessage = 'Server error: The AI service is currently experiencing issues. Please try again later.';
      } else if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = 'Network error: Please check your internet connection and try again.';
        } else {
          errorMessage = `Error: ${error.message}`;
        }
      }
      
      assistantBubble.innerHTML = `
        <div class="flex items-start gap-3 text-red-700 bg-red-50 p-4 rounded-xl border border-red-200">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
          </svg>
          <div class="flex flex-col">
            <span class="text-sm font-semibold">Message Failed</span>
            <span class="text-sm mt-1">${errorMessage}</span>
          </div>
        </div>
      `;
      
      // Remove the user's message from the history so it isn't sent in the next request
      messages.pop();
    } finally {
      chatInput.disabled = false;
      sendButton.disabled = false;
      chatInput.focus();
    }
  });
}

main();
