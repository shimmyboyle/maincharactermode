const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Handle WebSocket Connections
wss.on('connection', (clientSocket, req) => {
    
    // 1. SECURITY CHECK
    const parameters = url.parse(req.url, true);
    const providedPassword = parameters.query.password;
    const correctPassword = process.env.APP_PASSWORD;

    if (correctPassword && providedPassword !== correctPassword) {
        console.log("⛔ Access Denied: Wrong Password");
        clientSocket.send(JSON.stringify({ error: "Access Denied: Wrong Password" }));
        clientSocket.close();
        return;
    }
    
    console.log("✅ Client Authenticated.");

    // 2. CONNECT TO GEMINI
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
        console.error("Error: GEMINI_API_KEY is missing in Railway Variables");
        clientSocket.close();
        return;
    }

    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    
    let geminiSocket;
    // 🆕 QUEUE: Holds messages while we wait for Google to answer
    let messageQueue = []; 

    try {
        geminiSocket = new WebSocket(GEMINI_URL);
    } catch (err) {
        console.error("Failed to connect to Gemini:", err);
        clientSocket.close();
        return;
    }

    geminiSocket.onopen = () => {
        console.log("Connected to Gemini. Flushing queue...");
        // 🆕 FLUSH: Send all the waiting messages (like the Setup config)
        while (messageQueue.length > 0) {
            geminiSocket.send(messageQueue.shift());
        }
    };

    // Client -> Server -> Gemini
    clientSocket.on('message', (data) => {
        if (geminiSocket.readyState === WebSocket.OPEN) {
            geminiSocket.send(data);
        } else {
            // 🆕 BUFFER: If not ready, save the message for later
            console.log("Buffering message...");
            messageQueue.push(data);
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
    
    geminiSocket.on('close', (code, reason) => {
        console.log(`Gemini closed connection: ${code} - ${reason}`);
        clientSocket.close();
    });

    clientSocket.on('close', () => {
        if (geminiSocket.readyState === WebSocket.OPEN) geminiSocket.close();
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🕵️ Noir Server listening on port ${PORT}`);
});