import { createPortfolioApp } from "../backend/server.js";

let appPromise;

export default async function handler(req, res) {
  try {
    appPromise ??= createPortfolioApp();
    const app = await appPromise;
    app.emit("request", req, res);
  } catch (error) {
    console.error("API initialization failed:", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Server initialization failed" }));
    }
  }
}
