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
const downloadPdfButton = document.getElementById('download-pdf-button') as HTMLButtonElement;

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

async function downloadPdf() {
  const originalHtml = downloadPdfButton.innerHTML;
  downloadPdfButton.disabled = true;
  downloadPdfButton.innerHTML = '<span class="animate-spin mr-2">⏳</span> Generating...';

  try {
    // Get the chat history HTML
    const chatContent = chatHistory.innerHTML;
    
    // Create a full HTML document for PDF conversion
    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; background: white; }
            .markdown-body { line-height: 1.6; }
            .markdown-body p { margin-bottom: 1rem; }
            .markdown-body ul { list-style-type: disc; padding-left: 1.5rem; margin-bottom: 1rem; }
            .markdown-body pre { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem; overflow-x: auto; }
            .markdown-body code { font-family: monospace; background: #f3f4f6; padding: 0.2rem 0.4rem; border-radius: 0.25rem; }
          </style>
        </head>
        <body>
          <div class="max-w-4xl mx-auto space-y-6">
            <h1 class="text-3xl font-bold text-gray-900 border-b pb-4 mb-8">AI Chat History</h1>
            ${chatContent}
          </div>
        </body>
      </html>
    `;

    const response = await fetch('/api/generate-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ html: fullHtml }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate PDF');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chat-history.pdf';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error: any) {
    console.error('PDF Download Error:', error);
    alert(`Failed to download PDF: ${error.message}`);
  } finally {
    downloadPdfButton.disabled = false;
    downloadPdfButton.innerHTML = originalHtml;
  }
}

async function main() {
  downloadPdfButton.addEventListener('click', downloadPdf);
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
      let stream;
      let retries = 0;
      const maxRetries = 3;

      while (retries < maxRetries) {
        try {
          stream = await openai.chat.completions.create({
            model: 'models/gemini-2.5-flash',
            messages: messages,
            stream: true,
          });
          break; // Success
        } catch (error: any) {
          retries++;
          const isTransient = error?.status === 429 || 
                              (error?.status >= 500 && error?.status < 600) || 
                              (error instanceof Error && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')));
          
          if (!isTransient || retries >= maxRetries) {
            throw error; // Non-transient or max retries reached
          }
          
          const backoff = Math.pow(2, retries - 1) * 1000;
          assistantBubble.innerHTML = `<span class="animate-pulse text-gray-500 italic text-sm">Transient error. Retrying in ${backoff/1000}s... (${retries}/${maxRetries})</span>`;
          await new Promise(resolve => setTimeout(resolve, backoff));
          assistantBubble.innerHTML = '<span class="animate-pulse">Thinking...</span>';
        }
      }

      if (!stream) throw new Error('Failed to initialize stream');
      
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
