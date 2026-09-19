const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/rooms', (_req, res) => {
  const roomId = createRoom();
  res.status(201).json({ roomId });
});

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, role }) => {
    if (!roomId || !isValidRole(role)) {
      socket.emit('app-error', '無法加入房間。');
      return;
    }

    const room = getOrCreateRoom(roomId);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;

    if (role === 'screen') {
      room.screenCount += 1;
    }

    if (role === 'remote') {
      room.remoteCount += 1;
    }

    socket.emit('room-joined', { roomId, state: buildRoomState(room) });
    broadcastState(roomId);
  });

  socket.on('add-video', ({ roomId, input }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('app-error', '找不到房間。');
      return;
    }

    const normalized = normalizeVideoInput(input);
    if (!normalized) {
      socket.emit('app-error', '請輸入有效的 YouTube 連結或影片 ID。');
      return;
    }

    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      videoId: normalized.videoId,
      source: input.trim(),
      label: normalized.label,
      addedAt: Date.now()
    };

    if (!room.current) {
      room.current = item;
      room.playback = createPlaybackState();
    } else {
      room.queue.push(item);
    }

    broadcastState(roomId);
  });

  socket.on('playback-command', ({ roomId, action, value }) => {
    const room = rooms.get(roomId);
    if (!room || !room.current) {
      return;
    }

    applyPlaybackCommand(room, action, value);
    broadcastState(roomId);
  });

  socket.on('video-ended', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    goToNextSong(room);
    broadcastState(roomId);
  });

  socket.on('disconnect', () => {
    const { roomId, role } = socket.data;
    if (!roomId || !role) {
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    if (role === 'screen' && room.screenCount > 0) {
      room.screenCount -= 1;
    }

    if (role === 'remote' && room.remoteCount > 0) {
      room.remoteCount -= 1;
    }

    if (room.screenCount === 0 && room.remoteCount === 0) {
      rooms.delete(roomId);
      return;
    }

    broadcastState(roomId);
  });
});

function isValidRole(role) {
  return role === 'screen' || role === 'remote';
}

function createRoom() {
  let roomId = '';

  do {
    roomId = Array.from({ length: 6 }, () => {
      const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
      return ROOM_CODE_ALPHABET[index];
    }).join('');
  } while (rooms.has(roomId));

  rooms.set(roomId, {
    current: null,
    queue: [],
    playback: createPlaybackState(),
    screenCount: 0,
    remoteCount: 0,
    createdAt: Date.now()
  });

  return roomId;
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      current: null,
      queue: [],
      playback: createPlaybackState(),
      screenCount: 0,
      remoteCount: 0,
      createdAt: Date.now()
    });
  }

  return rooms.get(roomId);
}

function createPlaybackState() {
  return {
    isPlaying: false,
    currentTime: 0,
    updatedAt: Date.now()
  };
}

function normalizeVideoInput(rawInput) {
  if (!rawInput || !rawInput.trim()) {
    return null;
  }

  const input = rawInput.trim();
  const idMatch = input.match(/^[a-zA-Z0-9_-]{11}$/);
  if (idMatch) {
    return {
      videoId: input,
      label: `YouTube 影片 ${input}`
    };
  }

  try {
    const url = new URL(input);
    if (url.hostname === 'youtu.be') {
      const shortId = url.pathname.slice(1, 12);
      if (shortId.length === 11) {
        return {
          videoId: shortId,
          label: `YouTube 影片 ${shortId}`
        };
      }
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname === 'youtube.com' || hostname === 'www.youtube.com' || hostname.endsWith('.youtube.com')) {
      const videoId = url.searchParams.get('v');
      if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return {
          videoId,
          label: `YouTube 影片 ${videoId}`
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function applyPlaybackCommand(room, action, value) {
  switch (action) {
    case 'play': {
      if (!room.playback.isPlaying) {
        room.playback.isPlaying = true;
        room.playback.updatedAt = Date.now();
      }
      break;
    }
    case 'pause': {
      if (room.playback.isPlaying) {
        room.playback.currentTime = getPlaybackTime(room.playback);
        room.playback.isPlaying = false;
        room.playback.updatedAt = Date.now();
      }
      break;
    }
    case 'seek': {
      const nextTime = Number(value);
      if (Number.isFinite(nextTime) && nextTime >= 0) {
        room.playback.currentTime = nextTime;
        room.playback.updatedAt = Date.now();
      }
      break;
    }
    case 'forward': {
      room.playback.currentTime = getPlaybackTime(room.playback) + 10;
      room.playback.updatedAt = Date.now();
      break;
    }
    case 'rewind': {
      room.playback.currentTime = Math.max(0, getPlaybackTime(room.playback) - 10);
      room.playback.updatedAt = Date.now();
      break;
    }
    case 'next': {
      goToNextSong(room);
      break;
    }
    default:
      break;
  }
}

function goToNextSong(room) {
  room.current = room.queue.shift() || null;
  room.playback = createPlaybackState();
}

function getPlaybackTime(playback) {
  if (!playback.isPlaying) {
    return playback.currentTime;
  }

  return playback.currentTime + (Date.now() - playback.updatedAt) / 1000;
}

function buildRoomState(room) {
  return {
    current: room.current,
    queue: room.queue,
    playback: {
      isPlaying: room.playback.isPlaying,
      currentTime: getPlaybackTime(room.playback),
      updatedAt: room.playback.updatedAt
    },
    screenCount: room.screenCount,
    remoteCount: room.remoteCount
  };
}

function broadcastState(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit('state-sync', { roomId, state: buildRoomState(room) });
}

server.listen(PORT, () => {
  console.log(`KTV server is running on http://localhost:${PORT}`);
});
