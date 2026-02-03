// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
const PCM_SAMPLE_RATE = 24000;
const MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025";
const FPS_INTERVAL = 1000; 

// State variables
let ws = null;
let audioCtx = null;
let mediaStream = null;
let videoInterval = null;
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
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: PCM_SAMPLE_RATE });
        
        // 🔊 CRITICAL: Force Resume if suspended
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        
        nextAudioTime = audioCtx.currentTime;
        log(`Audio Engine Started (State: ${audioCtx.state})`);
    } catch (e) {
        log("Audio Init Failed: " + e.message, true);
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
        document.getElementById("status").innerText = "Transmission Active";
        toggleButtons(true);
        isRunning = true;
        
        sendSetupMessage();
        

        startVideoLoop();
    };

    ws.onmessage = async (event) => {
        let data = event.data;
        
        // Handle JSON
        if (typeof data === "string") {
            try {
                const msg = JSON.parse(data);
                
                // Handle Access Error
                if (msg.error) {
                    log("Server Error: " + msg.error, true);
                    stopApp();
                    return;
                }

                // Handle Audio Data inside JSON
                if (msg.serverContent?.modelTurn?.parts) {
                    for (const part of msg.serverContent.modelTurn.parts) {
                        if (part.inlineData) {
                            // 🔊 Log that we received data (only once every few seconds to avoid spam)
                            if (Math.random() < 0.1) log("⬇ Received Audio Chunk");
                            playAudioChunk(base64ToArrayBuffer(part.inlineData.data));
                        }
                    }
                }
                
                // Handle Turn Complete (Model finished a sentence)
                if (msg.serverContent?.turnComplete) {
                    log("✅ Model finished speaking turn.");
                }

            } catch(e) { /* Not JSON, ignore */ }
        }
        
        // Handle Blob (Binary)
        else if (data instanceof Blob) {
            log("⬇ Received Binary Audio");
            playAudioChunk(await data.arrayBuffer());
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
    if (videoInterval) clearInterval(videoInterval);
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
                "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Puck" } } }
            },
            "systemInstruction": {
                "parts": [{ 
                    "text": "You are a cynical, hard-boiled detective narrator in a 1940s noir novel. Narrate the video stream in real-time. Keep it punchy." 
                }]
            }
        }
    };
    ws.send(JSON.stringify(setup_msg));
}

// 🆕 Helper to send text (kickstart)
function sendTextMessage(text) {
    const msg = {
        "clientContent": {
            "turns": [{
                "role": "user",
                "parts": [{ "text": text }]
            }],
            "turnComplete": true
        }
    };
    ws.send(JSON.stringify(msg));
}

function startVideoLoop() {
    const video = document.getElementById("preview");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    
    videoInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN && isRunning) {
            canvas.width = video.videoWidth * 0.5;
            canvas.height = video.videoHeight * 0.5;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const base64Data = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
            ws.send(JSON.stringify({
                "realtimeInput": { "mediaChunks": [{ "mimeType": "image/jpeg", "data": base64Data }] }
            }));
        }
    }, FPS_INTERVAL); 
}

function playAudioChunk(arrayBuffer) {
    // 1. Convert PCM to Float32
    const float32Data = pcm16ToFloat32(arrayBuffer);
    
    // 🔍 DEBUG: Check loudness
    let maxVol = 0;
    for (let i = 0; i < float32Data.length; i++) {
        if (Math.abs(float32Data[i]) > maxVol) maxVol = Math.abs(float32Data[i]);
    }
    
    // Log volume (only if it's actual sound)
    if (maxVol > 0.01) {
        log(`🔊 Playing Audio (Vol: ${maxVol.toFixed(2)})`);
    } else {
        log(`🔈 Received Silence/Empty Audio`);
    }

    // 2. Schedule Playback
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
        // "true" forces Little Endian, which is standard for WAV/PCM
        const int16 = dataView.getInt16(i * 2, true); 
        float32[i] = int16 / 32768;
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