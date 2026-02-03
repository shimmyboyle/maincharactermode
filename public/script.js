// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
const PCM_SAMPLE_RATE = 24000;
const MODEL = "models/gemini-2.0-flash-exp";

// 🎞️ CAMERA SPEED SETTING
// 1000 = 1 frame per second (Standard)
// 2000 = 1 frame every 2 seconds (Slower, moodier, saves data)
// 500  = 2 frames per second (Faster, more responsive)
const FPS_INTERVAL = 250; 

// State variables
let ws = null;
let audioCtx = null;
let mediaStream = null;
let videoInterval = null;
let nextAudioTime = 0;
let isRunning = false;

async function startApp() {
    // 🔒 ASK FOR PASSWORD
    const password = prompt("Enter Case Password:");
    if (!password) return; // Stop if cancelled

    // 1. Audio Context
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: PCM_SAMPLE_RATE });
    await audioCtx.resume();
    nextAudioTime = audioCtx.currentTime;

    // 2. Camera Access
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, facingMode: "environment" },
            audio: false 
        });
        document.getElementById("preview").srcObject = mediaStream;
    } catch (err) {
        updateStatus("Camera Error: " + err.message);
        return;
    }

    // 3. Connect to Backend with Password
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Append password to the URL query string
    const wsUrl = `${protocol}//${window.location.host}/?password=${encodeURIComponent(password)}`;
    
    updateStatus("Connecting to headquarters...");
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        updateStatus("Connected. Narration starting...");
        toggleButtons(true);
        isRunning = true;
        sendSetupMessage();
        startVideoLoop();
    };

    ws.onmessage = async (event) => {
        let data = event.data;
        
        // If the server sends an access denied JSON
        try {
            const possibleJson = JSON.parse(data);
            if (possibleJson.error) {
                alert(possibleJson.error);
                stopApp();
                return;
            }
        } catch(e) {
            // It wasn't JSON, continue processing as normal
        }

        if (data instanceof Blob) {
            playAudioChunk(await data.arrayBuffer());
        } else {
            const msg = JSON.parse(data);
            if (msg.serverContent?.modelTurn?.parts) {
                for (const part of msg.serverContent.modelTurn.parts) {
                    if (part.inlineData) {
                        playAudioChunk(base64ToArrayBuffer(part.inlineData.data));
                    }
                }
            }
        }
    };
    
    ws.onclose = () => stopApp();
    ws.onerror = () => updateStatus("Connection Error.");
}

function stopApp() {
    isRunning = false;
    if (ws) ws.close();
    if (videoInterval) clearInterval(videoInterval);
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    if (audioCtx) audioCtx.close();
    toggleButtons(false);
    updateStatus("Case Closed.");
}

function sendSetupMessage() {
    const setup_msg = {
        "setup": {
            "model": MODEL,
            "systemInstruction": {
                "parts": [{ 
                    "text": "You are a cynical, hard-boiled detective narrator in a 1940s noir novel. Narrate the video stream in real-time. Use slang like 'dame', 'shamus', 'two-bit'. Keep it punchy." 
                }]
            },
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Puck" } } }
            }
        }
    };
    ws.send(JSON.stringify(setup_msg));
}

function startVideoLoop() {
    const video = document.getElementById("preview");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    
    // Uses the FPS_INTERVAL variable defined at the top
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
    const float32Data = pcm16ToFloat32(arrayBuffer);
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

function updateStatus(text) { document.getElementById("status").innerText = text; }
function toggleButtons(on) {
    document.getElementById("startBtn").style.display = on ? "none" : "inline-block";
    document.getElementById("stopBtn").style.display = on ? "inline-block" : "none";
}