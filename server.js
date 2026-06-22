const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Create uploads folder if it doesn't exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// Multer setup for video uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});
const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed'), false);
        }
    },
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
});

app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOAD_DIR));

app.use(session({
    secret: 'veldrix_super_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

// ---- DATABASE HELPERS ----
function readDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            users: [],
            posts: [{
                id: 1,
                author: "Veldrix",
                content: "Welcome to Veldrix! 🎉 The new video social platform!",
                videoUrl: null,
                likes: 0,
                usersWhoLiked: [],
                comments: [],
                createdAt: new Date().toISOString()
            }],
            follows: []
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDatabase(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ---- AUTH ROUTES ----
app.post('/api/register', async (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });

    const db = readDatabase();
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: "Username already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    db.users.push({ 
        username, 
        password: hashedPassword,
        email: email || '',
        bio: '',
        profilePic: '',
        createdAt: new Date().toISOString(),
        online: true,
        lastSeen: new Date().toISOString()
    });
    writeDatabase(db);
    res.json({ success: true, message: "Account created! Please login." });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const db = readDatabase();
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Wrong password" });

    // Update online status
    user.online = true;
    user.lastSeen = new Date().toISOString();
    writeDatabase(db);

    req.session.user = username;
    res.json({ success: true, username });
});

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        const db = readDatabase();
        const user = db.users.find(u => u.username === req.session.user);
        res.json({ loggedIn: true, username: req.session.user, user });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/logout', (req, res) => {
    const db = readDatabase();
    const user = db.users.find(u => u.username === req.session.user);
    if (user) {
        user.online = false;
        user.lastSeen = new Date().toISOString();
        writeDatabase(db);
    }
    req.session.destroy();
    res.json({ success: true });
});

// ---- USER PROFILE ROUTES ----
app.get('/api/users/:username', (req, res) => {
    const db = readDatabase();
    const user = db.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: "User not found" });
    
    const followers = db.follows.filter(f => f.following === req.params.username);
    const following = db.follows.filter(f => f.follower === req.params.username);
    
    res.json({
        username: user.username,
        bio: user.bio || '',
        profilePic: user.profilePic || '',
        createdAt: user.createdAt,
        online: user.online || false,
        lastSeen: user.lastSeen,
        followers: followers.length,
        following: following.length
    });
});

app.post('/api/users/update', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Login required" });
    const { bio, profilePic } = req.body;
    const db = readDatabase();
    const user = db.users.find(u => u.username === req.session.user);
    if (user) {
        if (bio !== undefined) user.bio = bio;
        if (profilePic !== undefined) user.profilePic = profilePic;
        writeDatabase(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

// ---- FOLLOW ROUTES ----
app.post('/api/follow/:username', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Login required" });
    const target = req.params.username;
    if (target === req.session.user) return res.status(400).json({ error: "Cannot follow yourself" });

    const db = readDatabase();
    const user = db.users.find(u => u.username === target);
    if (!user) return res.status(404).json({ error: "User not found" });

    const exists = db.follows.find(f => f.follower === req.session.user && f.following === target);
    if (!exists) {
        db.follows.push({ follower: req.session.user, following: target });
        writeDatabase(db);
    }
    res.json({ success: true });
});

app.post('/api/unfollow/:username', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Login required" });
    const db = readDatabase();
    db.follows = db.follows.filter(f => !(f.follower === req.session.user && f.following === req.params.username));
    writeDatabase(db);
    res.json({ success: true });
});

app.get('/api/following', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Login required" });
    const db = readDatabase();
    const following = db.follows.filter(f => f.follower === req.session.user).map(f => f.following);
    res.json(following);
});

// ---- POST ROUTES (WITH VIDEO) ----
app.get('/api/posts', (req, res) => {
    const db = readDatabase();
    res.json(db.posts);
});

app.post('/api/posts', upload.single('video'), (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Login required" });
    const { content } = req.body;
    if (!content && !req.file) return res.status(400).json({ error: "Content or video required" });

    const db = readDatabase();
    const newPost = {
        id: Date.now(),
        author: req.session.user,
        content: content || '',
        videoUrl: req.file ? `/uploads/${req.file.filename}` : null,
        likes: 0,
        usersWhoLiked: [],
        comments: [],
        createdAt: new Date().toISOString()
    };
    db.posts.unshift(newPost);
    writeDatabase(db);
    res.status(201).json(newPost);
});

app.post('/api/posts/:id/like', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Login required" });
    const postId = parseInt(req.params.id);
    const db = readDatabase();
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const user = req.session.user;
    const idx = post.usersWhoLiked.indexOf(user);
    if (idx > -1) {
        post.usersWhoLiked.splice(idx, 1);
        post.likes--;
    } else {
        post.usersWhoLiked.push(user);
        post.likes++;
    }
    writeDatabase(db);
    res.json(post);
});

app.post('/api/posts/:id/comment', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Login required" });
    const postId = parseInt(req.params.id);
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Comment required" });

    const db = readDatabase();
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.comments.push({ 
        username: req.session.user, 
        text: text,
        timestamp: new Date().toISOString()
    });
    writeDatabase(db);
    res.json(post);
});

app.delete('/api/posts/:id', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Login required" });
    const postId = parseInt(req.params.id);
    let db = readDatabase();
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.author !== req.session.user) return res.status(403).json({ error: "You can only delete your own posts" });

    db.posts = db.posts.filter(p => p.id !== postId);
    writeDatabase(db);
    res.json({ success: true });
});

// ---- SEARCH USERS ----
app.get('/api/search', (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    const db = readDatabase();
    const results = db.users.filter(u => 
        u.username.toLowerCase().includes(q.toLowerCase())
    ).map(u => ({ username: u.username, bio: u.bio || '' }));
    res.json(results);
});

// ---- THE FRONTEND ----
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Veldrix - Video Social Platform</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700;900&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Poppins', sans-serif; }
        :root { --primary: #8B5CF6; --secondary: #6D28D9; --bg: #0F0A1A; --card: #1A1425; --text: #FFFFFF; --text2: #A78BFA; }
        body { background: var(--bg); color: var(--text); min-height: 100vh; }
        
        .app { max-width: 600px; margin: 0 auto; padding: 20px; }
        
        /* Header */
        .header { display: flex; justify-content: space-between; align-items: center; padding: 15px 0; border-bottom: 1px solid #2D1B4E; }
        .logo { font-size: 2rem; font-weight: 900; background: linear-gradient(135deg, #8B5CF6, #EC4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .nav-icons { display: flex; gap: 20px; }
        .nav-icons span { font-size: 1.5rem; cursor: pointer; transition: 0.3s; }
        .nav-icons span:hover { transform: scale(1.2); }
        
        /* Auth Box */
        .auth-box { background: var(--card); padding: 30px; border-radius: 20px; margin: 20px 0; border: 1px solid #2D1B4E; }
        .auth-box h3 { font-size: 1.8rem; margin-bottom: 15px; color: var(--text2); }
        .auth-box input { width: 100%; padding: 14px; margin: 8px 0; border-radius: 12px; border: 1px solid #2D1B4E; background: #1A1425; color: white; font-size: 1rem; }
        .auth-box input::placeholder { color: #6B5B7B; }
        .auth-box button { background: linear-gradient(135deg, var(--primary), var(--secondary)); color: white; border: none; padding: 14px; border-radius: 12px; cursor: pointer; font-weight: 700; width: 100%; font-size: 1rem; transition: 0.3s; }
        .auth-box button:hover { transform: scale(1.02); box-shadow: 0 0 30px rgba(139, 92, 246, 0.3); }
        .toggle-btn { background: none !important; color: var(--text2) !important; margin-top: 8px; box-shadow: none !important; }
        .status { margin-top: 10px; font-size: 0.9rem; }
        .google-btn { background: white !important; color: #333 !important; margin-top: 8px; }
        .google-btn:hover { background: #f0f0f0 !important; }
        
        /* Create Post */
        .create-box { background: var(--card); padding: 20px; border-radius: 20px; margin: 20px 0; border: 1px solid #2D1B4E; }
        .create-box textarea { width: 100%; height: 60px; padding: 12px; border-radius: 12px; border: 1px solid #2D1B4E; background: #1A1425; color: white; resize: none; outline: none; font-size: 1rem; }
        .create-box textarea::placeholder { color: #6B5B7B; }
        .video-upload { display: flex; align-items: center; gap: 10px; margin: 10px 0; padding: 12px; border: 2px dashed #2D1B4E; border-radius: 12px; cursor: pointer; }
        .video-upload:hover { border-color: var(--primary); }
        .create-box button { background: linear-gradient(135deg, var(--primary), var(--secondary)); color: white; border: none; padding: 12px; border-radius: 12px; cursor: pointer; font-weight: 700; width: 100%; margin-top: 5px; }
        
        /* Post Card */
        .post { background: var(--card); border-radius: 20px; padding: 20px; margin-bottom: 20px; border: 1px solid #2D1B4E; }
        .post-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .post-user { display: flex; align-items: center; gap: 10px; }
        .post-avatar { width: 45px; height: 45px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), #EC4899); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.2rem; }
        .post-username { font-weight: 600; }
        .post-time { font-size: 0.8rem; color: #6B5B7B; }
        .post-content { margin: 10px 0; line-height: 1.6; }
        .post-video { width: 100%; border-radius: 12px; margin: 10px 0; max-height: 500px; background: #000; }
        .post-video video { width: 100%; border-radius: 12px; max-height: 500px; }
        .post-actions { display: flex; gap: 20px; margin: 12px 0; padding-top: 12px; border-top: 1px solid #2D1B4E; }
        .action-btn { background: none; border: none; color: #6B5B7B; cursor: pointer; font-size: 0.9rem; display: flex; align-items: center; gap: 5px; transition: 0.3s; }
        .action-btn:hover { color: var(--text); }
        .action-btn.liked { color: #EC4899; }
        .action-btn svg { width: 20px; height: 20px; }
        .comments-section { background: #1A1425; border-radius: 12px; padding: 12px; margin-top: 10px; }
        .comment { font-size: 0.9rem; padding: 6px 0; border-bottom: 1px solid #2D1B4E; }
        .comment:last-child { border-bottom: none; }
        .comment strong { color: var(--text2); }
        .comment-input-box { display: flex; gap: 10px; margin-top: 10px; }
        .comment-input { flex-grow: 1; padding: 10px 14px; border-radius: 20px; border: 1px solid #2D1B4E; background: #1A1425; color: white; outline: none; }
        .comment-btn { background: var(--primary); color: white; border: none; padding: 8px 20px; border-radius: 20px; cursor: pointer; font-weight: 600; }
        .delete-btn { background: none; border: none; color: #EF4444; cursor: pointer; font-size: 0.8rem; }
        
        /* Tabs */
        .tabs { display: flex; gap: 10px; margin: 15px 0; }
        .tab { flex: 1; padding: 10px; text-align: center; background: #1A1425; border: none; color: #6B5B7B; border-radius: 12px; cursor: pointer; transition: 0.3s; font-weight: 600; }
        .tab.active { background: var(--primary); color: white; }
        
        /* Hidden utility */
        .hidden { display: none !important; }
        
        /* Online dot */
        .online-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-left: 5px; }
        .online-dot.online { background: #22C55E; }
        .online-dot.offline { background: #6B5B7B; }
        
        /* Responsive */
        @media (max-width: 480px) { .app { padding: 10px; } }
    </style>
</head>
<body>
<div class="app">
    <!-- HEADER -->
    <div class="header">
        <div class="logo">VELDRIX</div>
        <div class="nav-icons">
            <span>🏠</span>
            <span>🔍</span>
            <span>💬</span>
            <span>👤</span>
        </div>
    </div>

    <!-- STATUS BAR -->
    <div style="text-align:center; padding:10px 0;" id="statusBar">Loading...</div>

    <!-- AUTH BOX -->
    <div id="authBox" class="auth-box">
        <h3 id="formTitle">Welcome to Veldrix</h3>
        <input type="text" id="authUsername" placeholder="Username">
        <input type="email" id="authEmail" placeholder="Email (optional)">
        <input type="password" id="authPassword" placeholder="Password">
        <button id="authActionBtn">Sign Up</button>
        <button class="google-btn" onclick="alert('Google Sign-In coming soon!')">🔵 Continue with Google</button>
        <button class="toggle-btn" id="toggleAuthBtn">Already have an account? Login</button>
        <div id="authMessage" class="status"></div>
    </div>

    <!-- CREATE POST -->
    <div id="postBox" class="create-box hidden">
        <p style="margin-bottom:10px;">📝 Posting as: <strong id="displayName"></strong></p>
        <textarea id="postInput" placeholder="What's on your mind?"></textarea>
        <div class="video-upload" onclick="document.getElementById('videoInput').click()">
            <span>🎬</span> <span id="videoLabel">Tap to upload a video</span>
        </div>
        <input type="file" id="videoInput" accept="video/*" style="display:none;" onchange="updateVideoLabel(this)">
        <button onclick="createPost()">🚀 Share</button>
        <button onclick="logout()" style="background:#EF4444; margin-top:5px;">Logout</button>
    </div>

    <!-- TABS -->
    <div class="tabs">
        <button class="tab active" onclick="switchTab('feed')">📱 Feed</button>
        <button class="tab" onclick="switchTab('search')">🔍 Search</button>
        <button class="tab" onclick="switchTab('profile')">👤 Profile</button>
    </div>

    <!-- FEED -->
    <div id="feedTab">
        <div id="feed"></div>
    </div>

    <!-- SEARCH TAB -->
    <div id="searchTab" class="hidden">
        <div class="auth-box">
            <h3>Find People</h3>
            <input type="text" id="searchInput" placeholder="Search username..." oninput="searchUsers(this.value)">
            <div id="searchResults" style="margin-top:10px;"></div>
        </div>
    </div>

    <!-- PROFILE TAB -->
    <div id="profileTab" class="hidden">
        <div class="auth-box" id="profileBox">
            <h3 id="profileUsername">Profile</h3>
            <div id="profileInfo">
                <p><span class="online-dot" id="profileStatus"></span> <span id="profileStatusText">Offline</span></p>
                <p style="margin:5px 0; color:#6B5B7B;" id="profileBio">No bio yet</p>
                <p style="margin:5px 0; color:#6B5B7B;">👥 <span id="profileFollowers">0</span> followers · <span id="profileFollowing">0</span> following</p>
                <p style="margin:5px 0; color:#6B5B7B; font-size:0.8rem;">Joined: <span id="profileJoined"></span></p>
            </div>
            <div style="margin-top:15px;">
                <h4>Edit Profile</h4>
                <input type="text" id="editBio" placeholder="Your bio..." style="margin-bottom:5px;">
                <button onclick="updateProfile()" style="width:100%;">Update Bio</button>
            </div>
        </div>
    </div>
</div>

<script>
    const API = '/api';
    let currentUser = null;
    let isLogin = false;
    let selectedFile = null;

    // ---- INIT ----
    function updateVideoLabel(input) {
        const label
