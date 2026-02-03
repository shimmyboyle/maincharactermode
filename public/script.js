// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
const PCM_SAMPLE_RATE = 24000;
const MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025";
const FPS_INTERVAL = 200; 

// State variables
let ws = null;
let audioCtx = null;
let mediaStream = null;
let videoInterval = null;
let narratorInterval = null; // 🆕 Added to track the pulse loop
let nextAudioTime = 0;
let isRunning = false;

// 🐞 DEBUG LOGGER
function log(msg, isError = false) {
    const consoleDiv = document.getElementById("console-log");
    const line = document.createElement("div");
    line.style.color = isError ? "#ff5555" : "#00ff00";
    line.innerText = `> ${msg}`;
    consoleDiv.appendChild(line);
    consoleDiv.scrollTop = consoleDiv.scrollHeight; 
    console.log(msg); 
}

async function startApp() {
    log("Attempting to start...");
    
    const passwordField = document.getElementById("passwordInput");
    const password = passwordField.value.trim();
    
    if (!password) {
        log("Error: Password is empty.", true);
        alert("Please enter a password.");
        return;
    }

    // 1. Initialize Audio Context
    try {
        log("Initializing Audio Context...");
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        const buffer = audioCtx.createBuffer(1, 1, 22050); 
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start(0);
        
        log(`Audio Engine Started (Rate: ${audioCtx.sampleRate}Hz)`);

    } catch (e) {
        log("Audio Context Failed: " + e, true);
        alert("Audio failed to start. Please touch the screen and try again.");
        return;
    }

    // 2. Camera Access
    try {
        log("Requesting Camera...");
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 640 }, facingMode: "environment" },
            audio: false 
        });
        document.getElementById("preview").srcObject = mediaStream;
        log("Camera Active.");
    } catch (err) {
        log("Camera Error: " + err.name + " - " + err.message, true);
        return;
    }

    // 3. Connect to Backend
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/?password=${encodeURIComponent(password)}`;
    
    log(`Connecting to Server...`);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        log("WebSocket Connected!");
        document.getElementById("status").innerText = "Investigation Active";
        toggleButtons(true);
        isRunning = true;
        
        sendSetupMessage();
        
        startVideoLoop();
        
        // Wait 2s before starting the narrator pulse
        setTimeout(() => startNarratorLoop(), 2000); 
    };

    ws.onmessage = async (event) => {
        let data = event.data;
        if (data instanceof Blob) {
            data = await data.text();
        }
        
        if (typeof data === "string") {
            try {
                const msg = JSON.parse(data);
                if (msg.error) {
                    log("Server Error: " + msg.error, true);
                    stopApp();
                    return;
                }

                if (msg.serverContent?.modelTurn?.parts) {
                    for (const part of msg.serverContent.modelTurn.parts) {
                        if (part.inlineData) {
                            if (Math.random() < 0.1) log("⬇ Received Audio");
                            playAudioChunk(base64ToArrayBuffer(part.inlineData.data));
                        }
                    }
                }
                
                if (msg.serverContent?.turnComplete) {
                    // log("✅ Turn complete."); 
                }

            } catch(e) { 
                log("Error parsing JSON: " + e.message, true);
            }
        }
    };
    
    ws.onclose = (event) => {
        log(`Connection Closed (Code: ${event.code})`, true);
        stopApp();
    };
}

function stopApp() {
    isRunning = false;
    if (ws) ws.close();
    
    // 🛑 STOP BOTH LOOPS
    if (videoInterval) clearInterval(videoInterval);
    if (narratorInterval) clearInterval(narratorInterval); // 🆕 Fix: Stops the Pulse
    
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    if (audioCtx) audioCtx.close();
    toggleButtons(false);
    document.getElementById("status").innerText = "Disconnected";
    log("App Stopped.");
}

function sendSetupMessage() {
    const setup_msg = {
        "setup": {
            "model": MODEL,
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Aoede" } }
                }
            },
            "systemInstruction": {
                "parts": [{ 
                    "text": "You are a cynical noir detective narrating your own life. You are looking at a video stream. Describe EXACTLY what you see (people, objects, text) but describe it with a gritty, 1940s metaphor. If you see nothing, complain about the darkness." 
                }]
            }
        }
    };
    ws.send(JSON.stringify(setup_msg));
}

function startVideoLoop() {
    videoInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN && isRunning) {
            const video = document.getElementById("preview");
            if (video.videoWidth === 0 || video.videoHeight === 0) return;

            const targetWidth = 512; 
            const scaleFactor = targetWidth / video.videoWidth;
            const targetHeight = video.videoHeight * scaleFactor;

            const canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const base64Data = canvas.toDataURL("image/jpeg", 0.5).split(",")[1];

            ws.send(JSON.stringify({
                "realtimeInput": { 
                    "mediaChunks": [{ 
                        "mimeType": "image/jpeg", 
                        "data": base64Data 
                    }] 
                }
            }));
        }
    }, FPS_INTERVAL); 
}

function startNarratorLoop() {
    // 🆕 Fix: Assign to variable so we can stop it later
    narratorInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN && isRunning) {
            if (audioCtx && audioCtx.state === 'running') {
                const msg = {
                    "clientContent": {
                        "turns": [{
                            "role": "user",
                            "parts": [{ 
                                "text": "Look at the image. Mention specific objects, colors, or lighting you see right now." 
                            }]
                        }],
                        "turnComplete": true
                    }
                };
                ws.send(JSON.stringify(msg));
                if(Math.random() < 0.1) log("💓 Pulse sent");
            }
        }
    }, 4000); 
}

function playAudioChunk(arrayBuffer) {
    const float32Data = pcm16ToFloat32(arrayBuffer);
    
    // Volume Gate (Prevent playing pure silence)
    let maxVol = 0;
    for (let i = 0; i < float32Data.length; i++) {
        if (Math.abs(float32Data[i]) > maxVol) maxVol = Math.abs(float32Data[i]);
    }
    if (maxVol < 0.01) return; 

    const buffer = audioCtx.createBuffer(1, float32Data.length, PCM_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32Data);
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    
    const currentTime = audioCtx.currentTime;
    if (nextAudioTime < currentTime) nextAudioTime = currentTime;
    
    source.start(nextAudioTime);
    nextAudioTime += buffer.duration;
}

function pcm16ToFloat32(buffer) {
    const dataView = new DataView(buffer);
    const float32 = new Float32Array(buffer.byteLength / 2);
    for (let i = 0; i < float32.length; i++) {
        float32[i] = dataView.getInt16(i * 2, true) / 32768;
    }
    return float32;
}

function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function toggleButtons(on) {
    document.getElementById("startBtn").style.display = on ? "none" : "inline-block";
    document.getElementById("stopBtn").style.display = on ? "inline-block" : "none";
}