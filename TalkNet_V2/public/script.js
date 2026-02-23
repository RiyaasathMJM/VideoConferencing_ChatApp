// DOM Elements
const entrySection = document.getElementById('entry-section');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const callSection = document.getElementById('call-section');
const videosGrid = document.getElementById('videos-grid');
const localVideo = document.getElementById('localVideo');
const localParticipantName = document.getElementById('localParticipantName');
const roomNameDisplay = document.getElementById('roomName');

// State
let localStream;
let socket;
let currentRoom;
let userName;
let peerConnections = {};
let peerElements = {};

// Configuration
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Join room
joinBtn.onclick = async () => {
    const room = roomInput.value.trim();
    const name = nameInput.value.trim();
    
    if (!room || !name) {
        alert('Please enter both name and room');
        return;
    }

    userName = name;
    currentRoom = room;
    
    try {
        // Get media
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        localVideo.srcObject = localStream;
        localParticipantName.textContent = `${userName} (You)`;
        
        // Connect to server
        socket = io();
        
        socket.on('connect', () => {
            console.log('Connected to server');
            socket.emit('join_room', currentRoom);
        });
        
        // Handle existing peers
        socket.on('existing_peers', (peers) => {
            peers.forEach(peerId => {
                createPeerConnection(peerId, true);
            });
        });
        
        // Handle new user
        socket.on('user_joined', (peerId) => {
            createPeerConnection(peerId, false);
        });
        
        // Handle signaling
        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice_candidate', handleIceCandidate);
        
        // Handle user left
        socket.on('user_left', (peerId) => {
            if (peerConnections[peerId]) {
                peerConnections[peerId].close();
                delete peerConnections[peerId];
            }
            if (peerElements[peerId]) {
                peerElements[peerId].remove();
                delete peerElements[peerId];
            }
        });
        
        // Update UI
        entrySection.classList.add('hidden');
        callSection.classList.remove('hidden');
        roomNameDisplay.textContent = `Room: ${currentRoom}`;
        
    } catch (error) {
        console.error('Error:', error);
        alert('Could not access camera/microphone');
    }
};

function createPeerConnection(peerId, isInitiator) {
    // Create video element for peer
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = `wrapper-${peerId}`;
    
    const video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.autoplay = true;
    video.playsInline = true;
    
    const nameSpan = document.createElement('div');
    nameSpan.className = 'participant-name';
    nameSpan.textContent = `Peer ${peerId.slice(0, 5)}`;
    
    wrapper.appendChild(video);
    wrapper.appendChild(nameSpan);
    videosGrid.appendChild(wrapper);
    
    peerElements[peerId] = wrapper;
    
    // Create RTCPeerConnection
    const pc = new RTCPeerConnection(configuration);
    peerConnections[peerId] = pc;
    
    // Add local tracks
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    // Handle remote track
    pc.ontrack = (event) => {
        if (video.srcObject !== event.streams[0]) {
            video.srcObject = event.streams[0];
        }
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                target: peerId,
                candidate: event.candidate
            });
        }
    };
    
    // Handle connection state
    pc.onconnectionstatechange = () => {
        console.log(`Connection with ${peerId}: ${pc.connectionState}`);
    };
    
    // If initiator, create offer
    if (isInitiator) {
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                socket.emit('offer', {
                    target: peerId,
                    sdp: pc.localDescription
                });
            })
            .catch(console.error);
    }
    
    return pc;
}

async function handleOffer({ sdp, sender }) {
    const pc = peerConnections[sender];
    if (!pc) return;
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('answer', {
            target: sender,
            sdp: pc.localDescription
        });
    } catch (error) {
        console.error('Offer handling error:', error);
    }
}

async function handleAnswer({ sdp, sender }) {
    const pc = peerConnections[sender];
    if (!pc) return;
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (error) {
        console.error('Answer handling error:', error);
    }
}

async function handleIceCandidate({ candidate, sender }) {
    const pc = peerConnections[sender];
    if (!pc) return;
    
    try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
        console.error('ICE candidate error:', error);
    }
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (socket) {
        socket.disconnect();
    }
});