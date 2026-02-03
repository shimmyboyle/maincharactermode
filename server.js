const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const url = require('url'); // Added for URL parsing

const app = express();
// Railway assigns a port via environment variable. fallback to 3000 for local test.
const PORT = process.env.PORT || 3000;

// Initialize Server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Handle WebSocket Connections
wss.on('connection', (clientSocket, req) => {
    
    // --- 🔒 SECURITY CHECK ---
    // Parse the URL to find the password: wss://...?password=YOUR_SECRET
    const parameters = url.parse(req.url, true);
    const providedPassword = parameters.query.password;
    const correctPassword = process.env.APP_PASSWORD;

    // Only enforce password if one is set in Railway Variables
    if (correctPassword && providedPassword !== correctPassword) {
        console.log("⛔ Access Denied: Wrong Password");
        // Send a discrete error message before closing
        clientSocket.send(JSON.stringify({ error: "Access Denied: Wrong Password" }));
        clientSocket.close();
        return;
    }
    
    console.log("✅ Client Authenticated.");
    // -------------------------

    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
        console.error("Error: GEMINI_API_KEY is missing in Railway Variables");
        clientSocket.close();
        return;
    }

    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    
    let geminiSocket;

    try {
        geminiSocket = new WebSocket(GEMINI_URL);
    } catch (err) {
        console.error("Failed to connect to Gemini:", err);
        clientSocket.close();
        return;
    }

    geminiSocket.onopen = () => {
        console.log("Connected to Gemini.");
    };

    // Client -> Server -> Gemini
    clientSocket.on('message', (data) => {
        if (geminiSocket.readyState === WebSocket.OPEN) {
            geminiSocket.send(data);
        }
    });

    // Gemini -> Server -> Client
    geminiSocket.on('message', (data) => {
        if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(data);
        }
    });

    // Error Handling
    geminiSocket.on('error', (err) => console.error("Gemini Socket Error:", err));
    geminiSocket.on('close', () => clientSocket.close());
    clientSocket.on('close', () => {
        if (geminiSocket.readyState === WebSocket.OPEN) geminiSocket.close();
    });
});

server.listen(PORT, () => {
    console.log(`🕵️ Noir Server listening on port ${PORT}`);
});