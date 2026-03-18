import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import pdfcrowd from "pdfcrowd";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // PDF Generation Endpoint
  app.post("/api/generate-pdf", async (req, res) => {
    const { html } = req.body;
    
    const username = process.env.PDFCROWD_USERNAME;
    const apiKey = process.env.PDFCROWD_API_KEY;

    if (!username || !apiKey) {
      return res.status(500).json({ error: "Pdfcrowd credentials not configured." });
    }

    try {
      const client = new pdfcrowd.HtmlToPdfClient(username, apiKey);
      
      // Set some options for better PDF output
      client.setPageSize("A4");
      client.setOrientation("portrait");
      client.setNoMargins(false);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=chat-history.pdf");

      client.convertString(html, {
        error: (errorMessage: string, statusCode: number) => {
          console.error("Pdfcrowd Error:", errorMessage, statusCode);
          res.status(statusCode || 500).end(errorMessage);
        },
        data: (chunk: Buffer) => {
          res.write(chunk);
        },
        end: () => {
          res.end();
        }
      });
    } catch (error: any) {
      console.error("PDF Generation Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
