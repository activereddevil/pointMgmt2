import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging.js';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, getDoc, onSnapshot, query, where, getDocs, increment, serverTimestamp, writeBatch, arrayUnion, arrayRemove, deleteField, runTransaction, orderBy } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";    // --- Firebase Config (Auto-injected by Canvas) ---
const firebaseConfig = {
apiKey: "AIzaSyCt1hOqcgf8fGmPVtvrPztwzMQZvlrETfY",
authDomain: "pointmgmt-b8b87.firebaseapp.com",
projectId: "pointmgmt-b8b87",
storageBucket: "pointmgmt-b8b87.firebasestorage.app",
messagingSenderId: "966337707500",
appId: "1:966337707500:web:e4762479cb69abe7abd4c9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const messaging = getMessaging(app);
const appId = 'activeredpoint';


// --- Global State ---
let userRole = 'guest'; // 'teacher' or 'student'
let currentStudentData = null; // For student role
let students = [];
let rewards = [];
let history = [];
let quests = [];
let tempGuildSelection = new Set(); // 🧠 ตัวแปรจำรายชื่อสมาชิกที่ถูกเลือกชั่วคราว
let allGuilds = []; // เก็บข้อมูลกิลด์ล่าสุดตลอดเวลา
let allStudents = []; // เก็บข้อมูลนักเรียนไว้ด้วย (เพื่อให้เรียกวาดใหม่ได้)
// Default config values
let config = { 
    interest_rate: 1.0, 
    deduct_rate: 0, 
    clear_rate: 0
};
let rewardCategories = ['ทั่วไป']; // ค่าเริ่มต้น
let currentRewardSort = { field: 'name', dir: 'asc' }; // สถานะการเรียงลำดับปัจจุบัน
// --- SOUND ASSETS (Base64 เพื่อความสะดวก ไม่ต้องหาไฟล์) ---
// เสียงเหรียญ (สำหรับแต้มบวก)
const soundCoin = new Audio("https://cdn.freesound.org/previews/341/341695_5858296-lq.mp3"); 
// เสียงนกหวีด (สำหรับใบแดง/ลบแต้ม)
const soundWhistle = new Audio("https://cdn.freesound.org/previews/336/336899_4939433-lq.mp3");
// เสียงเกลือ (ตลกๆ)
const soundSalt = new Audio("https://cdn.freesound.org/previews/415/415209_5121236-lq.mp3"); 

// ตัวแปรเช็คว่าโหลดครั้งแรกหรือไม่ (เพื่อไม่ให้เสียงดังตอนเปิดโปรแกรม)
let isFirstHistoryLoad = true;
let processedNotifyIds = new Set(); // 🟢 1. เพิ่มบรรทัดนี้ (ตะกร้าเก็บ ID ที่แจ้งเตือนไปแล้ว)


let unsubscribers = [];
let sortState = {
    student: { col: null, asc: true },
    bank: { col: null, asc: true }
};
// Persistent Selection State
let selectedStudentIds = new Set();

// Pagination State
let paginationState = {
    home: 1,
    bank: 1,
    history: 1,
    guilds: 1
};
// Default Items Per Page (Changeable)
let itemsPerPage = 10;
const MARKET_SENSITIVITY = 0.005; 
const MIN_STOCK_PRICE = 1.00; // ราคาต่ำสุดที่เป็นไปได้

// --- Helper for Consistent Collection References (READ ONLY) ---
const collections = {
    students: () => collection(db, 'artifacts', appId, 'public', 'data', 'students'),
    rewards: () => collection(db, 'artifacts', appId, 'public', 'data', 'rewards'),
    history: () => collection(db, 'artifacts', appId, 'public', 'data', 'history'),
    quests: () => collection(db, 'artifacts', appId, 'public', 'data', 'quests'),
    config: () => collection(db, 'artifacts', appId, 'public', 'data', 'config'),
    guilds: () => collection(db, 'artifacts', appId, 'public', 'data', 'guilds')
};

// --- AUTHENTICATION LOGIC ---

async function initSystem() {
    const statusEl = document.getElementById('login-status');
    const btnStudent = document.getElementById('btn-submit-student');
    const btnTeacher = document.getElementById('btn-submit-teacher');
    
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
             await signInWithCustomToken(auth, __initial_auth_token);
        } else {
             await signInAnonymously(auth);
        }

        statusEl.textContent = 'สถานะเซิร์ฟเวอร์: ออนไลน์ พร้อมใช้งาน';
        statusEl.className = 'absolute bottom-2 left-0 w-full text-center text-xs text-green-500';
        
        btnStudent.disabled = false;
        btnStudent.classList.remove('opacity-50', 'cursor-not-allowed');
        btnStudent.textContent = 'เข้าดูคะแนน';
       if (btnTeacher) { 
        btnTeacher.disabled = false;
        btnTeacher.classList.remove('opacity-50', 'cursor-not-allowed');
        btnTeacher.textContent = 'เข้าสู่ระบบครู';
       }
    } catch (error) {
        console.error("Auth failed", error);
        statusEl.textContent = 'การเชื่อมต่อผิดพลาด: ' + error.message;
        statusEl.className = 'absolute bottom-2 left-0 w-full text-center text-xs text-red-500';
    }
}

initSystem();

// 🔔 ขอ Permission และบันทึก FCM Token
async function requestNotificationPermission() {
    try {
      // 1. ขอสิทธิ์แจ้งเตือน
      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        console.log('✅ Notification permission granted!');
        
        // 2. ดึง FCM Token (ต้องใส่ VAPID Key จาก Firebase Console)
        const token = await getToken(messaging, {
          vapidKey: 'BK6Ub2hAXBWwbNk0BS8phyh-0j-GAwX450NJnCzOwtwMGwHQ0icRU2pgEFo4-g1pSK4dvkKEDmZV-GwD4NTndVs' // ⚠️ เปลี่ยนตรงนี้!
        });
        
        if (token) {
          console.log('📱 FCM Token:', token);
          
          // 3. บันทึก Token ลง Firestore
          if (currentStudentData && currentStudentData.id) {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', currentStudentData.id), {
              fcmToken: token,
              lastTokenUpdate: serverTimestamp()
            });
            console.log('✅ Token saved to Firestore!');
          }
          
          showToast('🔔 เปิดการแจ้งเตือนสำเร็จ!');
        }
      } else {
        console.log('❌ Notification permission denied');
        showToast('⚠️ คุณปฏิเสธการแจ้งเตือน', 'error');
      }
    } catch (error) {
      console.error('❌ Error requesting permission:', error);
    }
  }
  
  // 🎯 รับ Notification ขณะเปิดแอพอยู่ (Foreground)
  onMessage(messaging, (payload) => {
    console.log('🔔 Received foreground message:', payload);
    
    const { title, body, icon } = payload.notification || {};
    const data = payload.data || {};
    
    // แสดงแบบ Browser Notification
    if (Notification.permission === 'granted') {
      new Notification(title || '📢 แจ้งเตือน', {
        body: body || 'คุณมีข้อความใหม่',
        icon: icon || '🔔',
        badge: '🎯',
        tag: data.type || 'default'
      });
    }
    
    // แสดงแบบ Toast (ของระบบที่มีอยู่)
    if (data.type === 'addpoints') {
      showGameNotification('addpoints', title, `+${data.amount}`, '⭐');
    } else if (data.type === 'removepoints') {
      showGameNotification('removepoints', title, `-${data.amount}`, '💔');
    } else {
      showToast(`${title}: ${body}`);
    }
  });

window.switchLoginTab = (tab) => {
    const studentForm = document.getElementById('form-login-student');
    const teacherForm = document.getElementById('form-login-teacher');
    const btnStudent = document.getElementById('btn-login-student');
    const btnTeacher = document.getElementById('btn-login-teacher');
    
    if (tab === 'student') {
        studentForm.classList.remove('hidden');
        teacherForm.classList.add('hidden');
        btnStudent.classList.replace('text-gray-400', 'text-red-600');
        btnStudent.classList.replace('border-transparent', 'border-red-600');
        btnTeacher.classList.replace('text-red-600', 'text-gray-400');
        btnTeacher.classList.replace('border-red-600', 'border-transparent');
    } else {
        studentForm.classList.add('hidden');
        teacherForm.classList.remove('hidden');
        btnTeacher.classList.replace('text-gray-400', 'text-red-600');
        btnTeacher.classList.replace('border-transparent', 'border-red-600');
        btnStudent.classList.replace('text-red-600', 'text-gray-400');
        btnStudent.classList.replace('border-red-600', 'border-transparent');
    }
};

window.handleStudentLogin = async () => {
    if (!auth.currentUser) return alert('ระบบยังไม่พร้อม กรุณารอสักครู่...');
    
    const stdId = document.getElementById('login-student-id').value.trim();
    const stdPass = document.getElementById('login-student-pass').value.trim(); // รับค่ารหัสผ่าน

    if (!stdId) return alert('กรุณากรอกเลขประจำตัว');
    if (!stdPass) return alert('กรุณากรอกรหัสผ่าน'); // บังคับกรอก
    
    try {
        const q = query(collections.students(), where("student_id", "==", stdId));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            alert('ไม่พบข้อมูลนักเรียนเลขที่นี้ครับ');
            return;
        }
        
        const docData = querySnapshot.docs[0];
        const data = docData.data();

        // 🔐 ตรวจสอบรหัสผ่าน
        // ถ้าในฐานข้อมูลไม่มี field password (เด็กเก่า) -> ให้ใช้ student_id เป็นรหัสผ่านแทน
        const correctPassword = data.password || data.student_id;

        if (stdPass !== correctPassword) {
            // เล่นเสียงเตือนผิดพลาด (ถ้ามี) หรือแค่แจ้งเตือน
            alert('❌ รหัสผ่านไม่ถูกต้องครับ');
            return;
        }
        
        // ผ่านฉลุย!
        currentStudentData = { id: docData.id, ...data };
        userRole = 'student';
        
        // Toast ต้อนรับ
        showToast(`ยินดีต้อนรับ ${data.full_name}`);
        initAppUI();
        
        setTimeout(() => {
            requestNotificationPermission();
          }, 1000);

    } catch (e) {
        console.error("Login Error:", e);
        alert('เกิดข้อผิดพลาดในการดึงข้อมูล: ' + e.message);
    }
};

window.handleTeacherLogin = async () => {
// 1. ประกาศตัวแปร Provider
const provider = new GoogleAuthProvider();

try {
    // 2. สั่งให้เด้งหน้าต่าง Login
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    console.log("Login Success:", user.email);

    // 3. กำหนดรายชื่ออีเมลครูที่มีสิทธิ์ (สำคัญมาก! แก้ตรงนี้เป็นเมลคุณออฟ)
    const allowedTeachers = [
        'activereddevil@gmail.com' // <--- แก้เป็นเมลจริงของคุณออฟ
        ]; 
    
    // 4. ตรวจสอบสิทธิ์
    if (allowedTeachers.includes(user.email)) {
        userRole = 'teacher';
        showToast(`✅ ยินดีต้อนรับครับ ครู ${user.displayName}!`);
        initAppUI();
    } else {
        // ถ้าไม่ใช่ครู ให้ดีดออก
        alert(`⛔ อีเมล ${user.email} ไม่มีสิทธิ์เข้าถึงส่วนจัดการครูครับ`);
        await signOut(auth);
        
        // รีเซ็ตหน้าจอ
        document.getElementById('app').classList.add('hidden');
        document.getElementById('login-screen').classList.remove('hidden');
    }

} catch (error) {
    console.error("Login Error:", error);
    alert('เกิดข้อผิดพลาด: ' + error.message);
}
};

window.handleLogout = async () => {
    // Stop interval
    if (window.interestInterval) clearInterval(window.interestInterval);
    isFirstHistoryLoad = true;
    processedNotifyIds.clear();
    // Unsubscribe all listeners
    unsubscribers.forEach(u => u());
    unsubscribers = [];
    
    // Clear state
    userRole = 'guest';
    currentStudentData = null;
    selectedStudentIds.clear();
    
    // Sign out firebase (optional but good practice)
    await signOut(auth);
    
    // Reset UI
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    
    // Reset inputs
    document.getElementById('login-student-id').value = '';
    document.getElementById('login-teacher-pass').value = '';
    
    // Re-init auth for next login (anonymous)
    signInAnonymously(auth);
};

// --- MAIN APP LOGIC ---

// ฟังก์ชันเริ่มดักฟังข้อมูลกิลด์ (เรียกใช้ตอนเปิดเว็บ หรือ login สำเร็จ)
window.initGuildListener = () => {
    const guildRef = collection(db, 'artifacts', appId, 'public', 'data', 'guilds');
    
    // 👂 ดักฟังแบบ Real-time
    onSnapshot(guildRef, (snapshot) => {
        // 1. เก็บข้อมูลกิลด์ล่าสุด
        allGuilds = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 2. จัดอันดับใหม่ทันที (เรียงตามคะแนนรวม)
        allGuilds.sort((a, b) => (b.total_points || 0) - (a.total_points || 0));

        // 3. กำหนด Rank ให้แต่ละกิลด์
        allGuilds.forEach((g, index) => {
            g.rank = index + 1; // ที่ 1, 2, 3...
        });

        console.log("🏆 Guilds Updated:", allGuilds);

        // 🔥 ไฮไลท์สำคัญ: สั่งวาดตารางนักเรียนใหม่เดี๋ยวนี้!
        if (typeof renderStudentList === 'function' && allStudents.length > 0) {
            renderStudentList(allStudents);
        }
    });
};

// 1. โหลดหมวดหมู่ (แก้ไข Path ให้ถูกต้อง)
async function loadRewardCategories() {
    try {
        // แก้ Path: ย้ายมาเก็บใน data/config/reward_categories
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'reward_categories');
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists() && docSnap.data().list) {
            rewardCategories = docSnap.data().list;
        } else {
            // ค่าเริ่มต้นถ้ายังไม่มีข้อมูล
            rewardCategories = ['ทั่วไป', 'อุปกรณ์การเรียน', 'ขนม/เครื่องดื่ม', 'สิทธิพิเศษ', 'ของสะสม'];
        }
        renderRewardCategoryOptions(); // อัปเดต Dropdown ทันทีที่โหลดเสร็จ
    } catch (e) { 
        console.error("Error loading categories:", e); 
        // กรณีโหลดพลาด ให้ใช้ค่า Default ไปก่อน
        renderRewardCategoryOptions(); 
    }
}

// 2. บันทึกหมวดหมู่ (แก้ไข Path และ Field ให้ตรงกัน)
async function saveRewardCategoriesToDB() {
    try {
        // แก้ Path: บันทึกลง data/config/reward_categories (Field: list)
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'reward_categories'), { 
            list: rewardCategories 
        }, { merge: true });
        
        renderRewardCategoryOptions(); // อัปเดต Dropdown หลังบันทึก
        showToast('บันทึกหมวดหมู่เรียบร้อย ✅');
    } catch (e) { 
        console.error(e); 
        alert('เกิดข้อผิดพลาดในการบันทึก: ' + e.message); 
    }
}

// ฟังก์ชันอัปเดตตัวเลือกใน Dropdown (Add/Edit Modal)
function renderRewardCategoryOptions() {
    const options = rewardCategories.map(c => `<option value="${c}">${c}</option>`).join('');
    
    const addSelect = document.getElementById('add-reward-category');
    if(addSelect) addSelect.innerHTML = options;
    
    const editSelect = document.getElementById('edit-reward-category');
    if(editSelect) editSelect.innerHTML = options;
}

// --- Modal Controller for Manage Categories ---
window.openManageRewardCategoriesModal = () => {
    const list = document.getElementById('manage-reward-cat-list');
    list.innerHTML = rewardCategories.map((c, i) => `
        <div class="flex justify-between items-center p-3 bg-gray-50 rounded-lg border">
            <span>${c}</span>
            ${c !== 'ทั่วไป' ? `<button onclick="deleteRewardCategory(${i})" class="text-red-500 hover:text-red-700 font-bold">ลบ</button>` : '<span class="text-xs text-gray-400">ค่าหลัก</span>'}
        </div>
    `).join('');
    document.getElementById('manage-reward-categories-modal').classList.remove('hidden');
    document.getElementById('manage-reward-categories-modal').classList.add('flex');
};

window.addRewardCategory = () => {
    const input = document.getElementById('new-reward-cat-name');
    const val = input.value.trim();
    if(val && !rewardCategories.includes(val)) {
        rewardCategories.push(val);
        saveRewardCategoriesToDB();
        input.value = '';
        openManageRewardCategoriesModal(); // Refresh List
    }
};

window.deleteRewardCategory = (index) => {
    if(confirm('ต้องการลบหมวดหมู่นี้?')) {
        rewardCategories.splice(index, 1);
        saveRewardCategoriesToDB();
        openManageRewardCategoriesModal(); // Refresh List
    }
};
// เริ่มต้นแอป
async function initAppUI() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    setupNavigation();
    subscribeToData();
    loadQuestCategories();
    loadRewardCategories();
    loadStreakConfig(); // โหลดค่าตั้งค่าเช็คชื่อ
    subscribeToStocks();
    initGuildListener();
    initBossSystem();
    loadBossDropOptions();
    
    // Clear previous intervals if any
    if (window.interestInterval) clearInterval(window.interestInterval);
    
    // Start new interval for Real-time Interest Update (30s)
    window.interestInterval = setInterval(() => {
        if (userRole === 'teacher') renderBankList(false); // Updated to pass false to prevent page reset on interval
        if (userRole === 'student') renderStudentDashboard();
    }, 45000); 
    
}

// ==========================================================
// 📅 STREAK SYSTEM LOGIC (ระบบเช็คชื่อ)
// ==========================================================

// ตัวแปร Config (เริ่มต้น)
let streakConfig = null;

// 1. โหลด Config ตอนเริ่มระบบ
// ✅ ฟังก์ชันใหม่: ฟังค่าแบบ Real-time (ครูแก้ปุ๊บ เด็กเปลี่ยนปั๊บ)
// ✅ ฟังก์ชันโหลด Config แบบ Real-time (ฉบับแก้ไขสมบูรณ์)
function loadStreakConfig() {
    console.log("📡 เริ่มดักฟังค่า Streak Config...");
    const ref = doc(db, 'artifacts', appId, 'public', 'config_streak');
    
    onSnapshot(ref, (snap) => {
        if (snap.exists()) {
            // 1. รับค่าใหม่จาก Firebase มาทับตัวแปร Global ทันที
            const newData = snap.data();
            
            // เช็คว่าค่าเปลี่ยนจริงไหม (กันรันซ้ำซ้อน)
            if (JSON.stringify(newData) !== JSON.stringify(streakConfig)) {
                streakConfig = newData; // อัปเดตตัวแปรหลัก
                console.log("🔄 ได้รับค่า Streak ใหม่:", streakConfig);

                // 2. อัปเดตหน้าตั้งค่าครู (ถ้าเปิดอยู่)
                if (document.getElementById('conf-streak-base')) {
                    document.getElementById('conf-streak-base').value = streakConfig.base_points;
                }
                                // 2. ✅ โหลดข้อมูลเข้าตัวแปร Dynamic ของเรา
                if (streakConfig.milestones && Array.isArray(streakConfig.milestones)) {
                    tempStreakMilestones = [...streakConfig.milestones]; // สำเนาข้อมูลมา
                } else {
                    tempStreakMilestones = []; // ถ้าไม่มี ให้เริ่มว่างๆ
                }

                // 3. สั่งวาด UI ใหม่ทันที
                if (typeof renderStreakSettingsUI === 'function') {
                    renderStreakSettingsUI();
                }
            }
        } else {
            console.warn("⚠️ ไม่พบ Config ใน DB ใช้ค่า Default แทน");
        }
    }, (error) => {
        console.error("❌ เกิดข้อผิดพลาดในการโหลด Streak Config:", error);
    });
}

// --- ตัวแปรเก็บค่าชั่วคราวสำหรับหน้าตั้งค่า ---
let tempStreakMilestones = [];

// 1. ฟังก์ชันวาดหน้าจอตั้งค่า (Render UI)
window.renderStreakSettingsUI = () => {
    const container = document.getElementById('streak-settings-container');
    if (!container) return;
    
    container.innerHTML = ''; // เคลียร์ของเก่า

    // เรียงลำดับตามวัน (น้อย -> มาก) เพื่อความสวยงาม
    tempStreakMilestones.sort((a, b) => a.days - b.days);

    tempStreakMilestones.forEach((tier, index) => {
        const row = document.createElement('div');
        row.className = 'grid grid-cols-12 gap-2 items-center text-sm bg-white p-2 rounded border border-orange-100 shadow-sm animate-fade-in-up';
        
        row.innerHTML = `
            <div class="col-span-1 text-center font-bold text-gray-400">${index + 1}</div>
            
            <div class="col-span-4 flex items-center gap-1">
                <span class="text-gray-500 text-xs">ครบ</span>
                <input type="number" value="${tier.days}" onchange="updateStreakTemp(${index}, 'days', this.value)" 
                    class="w-full border border-gray-300 rounded px-2 py-1 text-center focus:ring-2 focus:ring-orange-200 outline-none" placeholder="วัน">
            </div>
            
            <div class="col-span-6 flex items-center gap-1">
                <span class="text-gray-500 text-xs">รับ</span>
                <input type="number" value="${tier.bonus}" onchange="updateStreakTemp(${index}, 'bonus', this.value)" 
                    class="w-full border border-gray-300 rounded px-2 py-1 text-center font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-200 outline-none" placeholder="แต้ม">
            </div>
            
            <div class="col-span-1 text-center">
                <button onclick="removeStreakLevelRow(${index})" class="text-red-400 hover:text-red-600 hover:bg-red-50 rounded p-1 transition-colors">
                    🗑️
                </button>
            </div>
        `;
        container.appendChild(row);
    });
};

// 2. ฟังก์ชันอัปเดตค่าในตัวแปรชั่วคราว
window.updateStreakTemp = (index, key, value) => {
    const val = parseInt(value) || 0;
    tempStreakMilestones[index][key] = val;
};

// 3. ฟังก์ชันเพิ่มแถวใหม่
window.addStreakLevelRow = () => {
    // หาค่าวันสูงสุดที่มีอยู่ แล้วบวกเพิ่มไปอีกหน่อย (User Experience)
    const maxDay = tempStreakMilestones.length > 0 
        ? Math.max(...tempStreakMilestones.map(m => m.days)) 
        : 0;
        
    tempStreakMilestones.push({ days: maxDay + 7, bonus: 100 }); // ค่าเริ่มต้น
    renderStreakSettingsUI();
};

// 4. ฟังก์ชันลบแถว
window.removeStreakLevelRow = (index) => {
    if(confirm('ลบระดับนี้?')) {
        tempStreakMilestones.splice(index, 1);
        renderStreakSettingsUI();
    }
};

// 2. บันทึก Config (กดปุ่ม Save)
window.saveStreakConfig = async () => {
    const base = parseInt(document.getElementById('conf-streak-base').value) || 10;
    
    // ✅ ใช้ข้อมูลจากตัวแปร tempStreakMilestones แทนการวนลูป for(1..5)
    // กรองเอาอันที่วันเป็น 0 หรือติดลบออกเพื่อความชัวร์
    const cleanMilestones = tempStreakMilestones
        .filter(m => m.days > 0)
        .sort((a, b) => a.days - b.days); // เรียงตามวันจากน้อยไปมากเสมอ

    const newData = { 
        base_points: base, 
        milestones: cleanMilestones // บันทึกเป็น Array ลงไปเลย
    };

    try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'config_streak'), newData);
        
        // อัปเดตค่า Local ทันทีเพื่อให้ UI ไม่กระตุก
        streakConfig = newData; 
        
        showToast('✅ บันทึกการตั้งค่า Streak เรียบร้อย');
    } catch(e) { 
        console.error(e);
        alert('Error: ' + e.message); 
    }
};

// 3. แสดงผลหน้า Dashboard (เรียก function นี้ใน renderStudentDashboard)
function renderStreakWidget(student) {
    console.log("🚀 กำลังรัน renderStreakWidget..."); // เช็ค 1: ฟังก์ชันถูกเรียกไหม
    
    const widget = document.getElementById('student-streak-widget');
    if (!widget) {
        console.error("❌ หา HTML id='student-streak-widget' ไม่เจอ!");
        return;
    }

    console.log("✅ เจอ Widget แล้ว, UserRole =", window.userRole);

    // ปิดเงื่อนไขเช็ค Role ชั่วคราว เพื่อให้เห็นทุกคน
    // if (window.userRole !== 'student') { ... }

    widget.classList.remove('hidden'); // บังคับโชว์
    console.log("✨ สั่งโชว์แล้ว!");

    const sbtn = document.getElementById('btn-claim-streak');
    if (streakConfig === null) {
        if(sbtn) {
            sbtn.innerHTML = '<span class="animate-pulse">⏳ กำลังโหลดข้อมูล...</span>';
            sbtn.disabled = true;
            sbtn.classList.add('bg-gray-400');
            sbtn.classList.remove('from-orange-500', 'to-red-500');
        }
        return; // ⛔️ สั่งจบการทำงานทันที ไม่ต้องทำต่อข้างล่าง
    }
    
    const streakData = student.streak_data || { count: 0, last_claim: null, max: 0 };
    
    // Update Text
    document.getElementById('streak-count-display').textContent = streakData.count;
    document.getElementById('streak-max-display').textContent = streakData.max;

    // Check Button
    const btn = document.getElementById('btn-claim-streak');
    const timer = document.getElementById('streak-timer');
    const canClaim = checkCanClaim(streakData.last_claim);

    if (canClaim) {
        btn.disabled = false;
        btn.innerHTML = `🎁 รับ ${streakConfig.base_points} แต้ม`; // innerHTML เผื่อใส่ icon
        btn.classList.remove('bg-gray-400', 'cursor-not-allowed');
        btn.classList.add('from-orange-500', 'to-red-500');
        timer.classList.add('hidden');
        
    } else {
        btn.disabled = true;
        btn.innerHTML = "✅ รับแล้ว";
        btn.classList.remove('from-orange-500', 'to-red-500');
        btn.classList.add('bg-gray-400', 'cursor-not-allowed');
        timer.classList.remove('hidden');
    }

    // Update Progress Bar
    const nextMilestone = streakConfig.milestones.find(m => m.days > streakData.count);
    const bar = document.getElementById('streak-progress-bar');
    const hint = document.getElementById('next-reward-hint');
    
    if (nextMilestone) {
        const percent = Math.min(100, (streakData.count / nextMilestone.days) * 100);
        bar.style.width = `${percent}%`;
        hint.innerHTML = `อีก <b>${nextMilestone.days - streakData.count}</b> วัน รับโบนัส <b>+${nextMilestone.bonus}</b> แต้ม! 🎯`;
    } else {
        bar.style.width = '100%';
        hint.textContent = "สุดยอด! คุณรับรางวัลสูงสุดครบแล้ว 👑";
    }
}

// Helper: เช็คว่ากดรับได้ไหม (ข้ามวันหรือยัง)
function checkCanClaim(lastClaimTimestamp) {
    if (!lastClaimTimestamp) return true;
    const last = lastClaimTimestamp.toDate ? lastClaimTimestamp.toDate() : new Date(lastClaimTimestamp);
    const now = new Date();
    return last.getDate() !== now.getDate() || 
           last.getMonth() !== now.getMonth() || 
           last.getFullYear() !== now.getFullYear();
}

// 4. กดรับแต้ม (Action)
// ==========================================
// ✅ ฟังก์ชันเช็คชื่อรายวัน (ฉบับแก้ไข: ประกาศตัวแปร pointsEarned ถูกต้อง)
// ==========================================
window.claimDailyStreak = async () => {
    // 1. 🔒 UI Blocking
    const btn = document.getElementById('btn-claim-streak');
    const originalText = btn ? btn.innerHTML : '';
    
    if(btn) {
        if(btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<span class="animate-pulse">⏳ กำลังประมวลผล...</span>';
        btn.classList.add('bg-gray-400', 'cursor-not-allowed');
    }

    if (!currentStudentData) return;

    try {
        const studentRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', currentStudentData.id);

        // 2. 🛡️ Transaction
        // 🔥🔥🔥 แก้ไขจุดที่ Error: ต้องมี const pointsEarned = ... มารับค่าครับ
        const pointsEarned = await runTransaction(db, async (transaction) => {
            const sDoc = await transaction.get(studentRef);
            if (!sDoc.exists()) throw "ไม่พบข้อมูลนักเรียน";

            const sData = sDoc.data();
            const streakData = sData.streak_data || { count: 0, last_claim: null, max: 0 };

            if (!checkCanClaim(streakData.last_claim)) {
                throw "วันนี้คุณกดเช็กชื่อรับแต้มไปแล้วครับ";
            }

            // คำนวณ Streak
            let newCount = streakData.count;
            const last = streakData.last_claim ? (streakData.last_claim.toDate ? streakData.last_claim.toDate() : new Date(streakData.last_claim)) : null;
            const now = new Date();

            if (last) {
                const diffHours = (now - last) / (1000 * 60 * 60);
                if (diffHours > 48) newCount = 1;
                else newCount++;
            } else {
                newCount = 1;
            }
            
            const newMax = Math.max(streakData.max, newCount);
            
            // คำนวณแต้ม
            let pointsToAdd = streakConfig ? (streakConfig.base_points || 10) : 10;
            let milestoneBonus = 0;
            
            if (streakConfig && streakConfig.milestones) {
                const milestone = streakConfig.milestones.find(m => m.days === newCount);
                if (milestone) {
                    milestoneBonus = milestone.bonus;
                    pointsToAdd += milestone.bonus;
                }
            }

            // เตรียมข้อมูลอัปเดต
            const updates = {
                streak_data: { count: newCount, max: newMax, last_claim: serverTimestamp() }
            };

            const warningCount = sData.warning_cards || 0;
            let logMsg = `เช็คชื่อรายวัน (Day ${newCount})`;
            if (milestoneBonus > 0) logMsg += ` + โบนัส ${newCount} วัน!`;

            if (warningCount > 0) {
                updates.pending_points = increment(pointsToAdd);
                logMsg += ` (ถูกอายัดจากใบเตือน ${warningCount} ใบ)`;
            } else {
                updates.points = increment(pointsToAdd);
            }

            transaction.update(studentRef, updates);
            
            const newHistoryRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'history'));
            transaction.set(newHistoryRef, {
                student_id: sData.student_id,
                student_name: sData.full_name,
                action: logMsg,
                amount: pointsToAdd,
                type: 'daily_streak',
                timestamp: serverTimestamp()
            });

            // 🔥 Return ค่าแต้มออกมาจาก Transaction เพื่อให้ตัวแปร pointsEarned รับค่า
            return pointsToAdd; 
        });

        // 3. ✅ สำเร็จ
        showToast('✅ เช็คชื่อสำเร็จ!');
        
        // 🔥 สั่งตีบอส (ส่งแบบ Object { id: แต้ม })
        if (pointsEarned > 0) {
            await autoDamageBoss({
                [currentStudentData.id]: pointsEarned
            });
        }

    } catch (e) {
        console.error(e);
        const msg = typeof e === 'string' ? e : e.message;
        
        if (msg.includes('เช็กชื่อไปแล้ว')) {
            showToast('⚠️ วันนี้เช็กชื่อไปแล้วครับ', 'warning');
        } else {
            showToast('❌ เกิดข้อผิดพลาด: ' + msg, 'error');
        }

        if(btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
            btn.classList.remove('bg-gray-400', 'cursor-not-allowed');
        }
    }
};

function setupNavigation() {
    const nav = document.getElementById('nav-tabs');
    const roleDisplay = document.getElementById('user-role-display');
    let tabsHtml = '';
    
    if (userRole === 'teacher') {
        roleDisplay.textContent = 'สถานะ: ครู (Admin)';
        tabsHtml = `
            
            <button onclick="switchTab('home')" id="tab-home" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-red-500 text-red-600">รายชื่อนักเรียน</button>
            <button onclick="switchTab('punishment')" id="tab-punishment" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">⚠️ คุมประพฤติ</button>
            <button onclick="switchTab('guilds')" id="tab-guilds" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">🏰 กิลด์</button>
            
            <button onclick="switchTab('quests')" id="tab-quests" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">ภารกิจ</button>
            <button onclick="switchTab('teacher-stocks')" id="tab-teacher-stocks-btn" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">📈 ตลาดหุ้น</button>
            <button onclick="switchTab('admin-boss')" id="tab-admin-boss" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">👹 จัดการบอส</button>
            
            <button onclick="switchTab('history')" id="tab-history" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">ประวัติ</button>
            <button onclick="switchTab('rewards')" id="tab-rewards" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">รางวัล</button>
            
            <button onclick="switchTab('settings')" id="tab-settings" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">ตั้งค่า</button>
        `;
        document.getElementById('teacher-reward-controls').classList.remove('hidden');
        document.getElementById('teacher-history-controls').classList.remove('hidden');
        switchTab('home');
        loadBuffRulesConfig();
        loadQuestCategories();

    } else {
        roleDisplay.textContent = `สถานะ: นักเรียน (${currentStudentData.student_id})`;
        tabsHtml = `
            <button onclick="switchTab('student-dashboard')" id="tab-student-dashboard" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-red-500 text-red-600">หน้าหลัก</button>
            <button onclick="switchTab('rewards')" id="tab-rewards" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">ของรางวัล</button>
            <button onclick="switchTab('student-guild')" id="tab-student-guild" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">🏰 กิลด์</button>
            <button onclick="switchTab('stocks')" id="tab-stocks-btn" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-all flex items-center gap-2">
            📈 ตลาดหุ้น
        </button>
        `;
        document.getElementById('teacher-reward-controls').classList.add('hidden');
        document.getElementById('teacher-history-controls').classList.add('hidden');
        switchTab('student-dashboard');
    }
    nav.innerHTML = tabsHtml;
}

function subscribeToData() {
    // IMPORTANT: Check Auth Guard before subscribing
    if (!auth.currentUser) {
        console.warn("No user logged in, skipping listeners");
        return;
    }

    unsubscribers.forEach(u => u());
    unsubscribers = [];

    const onError = (error) => {
        console.error("Snapshot Error:", error);
        if (error.code === 'permission-denied') {
            showToast("สิทธิ์การเข้าถึงถูกปฏิเสธ (กรุณา Logout แล้วเข้าใหม่)");
        }
    };

    unsubscribers.push(onSnapshot(collections.students(), (snapshot) => {
        students = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        window.students = students;
        if (userRole === 'student') {
            const me = students.find(s => s.student_id === currentStudentData.student_id);
            if (me) {
                currentStudentData = me;
                renderStudentDashboard();
                const stockTab = document.getElementById('content-stocks');
                if (stockTab && !stockTab.classList.contains('hidden')) renderStockMarket();
                
            }
        } else {
            renderStudentList(false); // Don't reset page on live update
            renderGuildsDashboard();
        }
        renderBankList(false); // Don't reset page on live update
        // สั่งอัปเดต Dropdown รายชื่อคนตีบอส เมื่อข้อมูลนักเรียนมีการเปลี่ยนแปลง
        if (typeof loadManualAttackers === 'function') {
            loadManualAttackers();
        }
    }, onError));

    unsubscribers.push(onSnapshot(collections.rewards(), (snapshot) => {
        rewards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderRewards();
    }, onError));

    unsubscribers.push(onSnapshot(collections.history(), (snapshot) => {
        history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        history.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
        // --- ส่วนที่เพิ่ม: แจ้งเตือน Real-time ---
        // --- 🟢 ส่วนที่ปรับปรุง: แจ้งเตือน Real-time แบบรวบยอด (Group) ---
        if (!isFirstHistoryLoad) {
            let addedList = [];
            let removedList = [];
            let redCardList = [];

            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const h = change.doc.data();
                    const docId = change.doc.id; // ดึง ID ของเอกสาร

                    // ⭐ เช็คว่า ID นี้เคยแจ้งเตือนไปหรือยัง? ถ้าเคยแล้วให้ข้ามทันที (กันเบิ้ล)
                    if (processedNotifyIds.has(docId)) return;
                    processedNotifyIds.add(docId); // จดไว้ว่าแจ้งแล้ว

                    // จัดกลุ่มรายการ
                    if (h.type === 'add_points') addedList.push(h);
                    else if (h.type === 'remove_points') removedList.push(h);
                    
                }
            });

            // 3. ฟังก์ชันช่วยแสดงผล (ถ้ามา 1 คนโชว์ชื่อ, ถ้ามาหลายคนโชว์จำนวน)
            const triggerNotify = (list, type, prefixSingle, prefixMulti, suffixUnit = '') => {
                if (list.length === 0) return;
                
                if (list.length === 1) {
                    // กรณีมาคนเดียว (เหมือนเดิม)
                    const h = list[0];
                    let val = h.amount;
                    if (type === 'remove_points') val = -val;
                    showGameNotification(type, `${h.student_name} ${prefixSingle}`, val + suffixUnit);
                } else {
                    // กรณีมาหลายคน (รวบยอด)
                    const amount = list[0].amount; // ใช้ยอดของคนแรก (ปกติ Bulk จะให้เท่ากัน)
                    let val = amount;
                    if (type === 'remove_points') val = -val;
                    showGameNotification(type, `นักเรียน ${list.length} คน ${prefixMulti}`, val + suffixUnit);
                }
            };

            // 4. สั่งแจ้งเตือนทีละประเภท
            triggerNotify(addedList, 'add_points', 'ได้แต้ม', 'ได้รับแต้ม');
            triggerNotify(removedList, 'remove_points', 'ถูกหักแต้ม', 'ถูกหักแต้ม');
            triggerNotify(redCardList, 'red_card', 'โดนใบแดง!', 'ได้รับใบแดง', ' ใบ');
        }
        isFirstHistoryLoad = false;


        if (userRole === 'teacher') renderHistory(false);
        if (userRole === 'teacher') {
            const teacherStockTab = document.getElementById('content-teacher-stocks');
            if (teacherStockTab && !teacherStockTab.classList.contains('hidden')) 
                renderMarketActivity();   
                renderTeacherStockControl();
             
        }
        if (userRole === 'student') 
            renderStudentDashboard();
            const stockTab = document.getElementById('content-stocks');
                if (stockTab && !stockTab.classList.contains('hidden')) {
                    renderStockMarket();
                }
    }, onError));
    
    unsubscribers.push(onSnapshot(collections.config(), (snapshot) => {
        const settingsDoc = snapshot.docs.find(d => d.id === 'school_settings');
        
        if (settingsDoc) {
            const cfg = settingsDoc.data();
            config = { ...config, ...cfg };

            // --- ✅ [เพิ่มส่วนนี้] จัดการแสดงผลประกาศ ---
            const announceBanner = document.getElementById('announcement-banner');
            const announceText = document.getElementById('announcement-text');
            const announceDate = document.getElementById('announcement-date');
            const settingInput = document.getElementById('setting-announcement-input');

            if (config.announcement_msg) {
                // มีประกาศ -> โชว์แบนเนอร์
                if (announceBanner) {
                    announceBanner.classList.remove('hidden');
                    announceText.textContent = config.announcement_msg;
                    
                    // แปลงเวลาให้สวยงาม
                    if (config.announcement_time) {
                        let dateObj = config.announcement_time.toDate ? config.announcement_time.toDate() : new Date(config.announcement_time);
                        announceDate.textContent = dateObj.toLocaleDateString('th-TH', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        });
                    }
                }
            } else {
                // ไม่มีประกาศ -> ซ่อนแบนเนอร์
                if (announceBanner) announceBanner.classList.add('hidden');
            }

            // อัปเดตช่องกรอกในหน้า Setting (เฉพาะครู)
            if (settingInput && document.activeElement !== settingInput) {
                settingInput.value = config.announcement_msg || '';
            }
    // ------------------------------------------

            // --- 🤖 AUTO INTEREST CHANGE LOGIC ---
            checkAndRenderScheduledInterest(); // แสดงผล UI
            
            // เช็คว่าถึงเวลาหรือยัง (เฉพาะครูเท่านั้นที่จะเป็นคน Trigger เพื่อความปลอดภัย)
            if (userRole === 'teacher' && config.scheduled_time && config.scheduled_rate) {
                const now = Date.now();
                let schedTime = config.scheduled_time;
                if (typeof schedTime.toMillis === 'function') schedTime = schedTime.toMillis();
                
                // ถ้าเวลาปัจจุบัน เลยเวลากำหนดแล้ว -> ลุยเลย!
                if (now >= schedTime) {
                    executeScheduledInterestChange(); 
                }
            }
            
            document.getElementById('interest-rate-display').textContent = (config.interest_rate || 1.0).toFixed(2) + '%';
            const homeIntDisplay = document.getElementById('home-interest-display');
                if(homeIntDisplay) homeIntDisplay.textContent = (config.interest_rate || 1.0).toFixed(2);
                
            const stdIntDisplay = document.getElementById('student-interest-display');
                if(stdIntDisplay) stdIntDisplay.textContent = (config.interest_rate || 1.0).toFixed(2);

            if (userRole === 'teacher') {
                 // Check if focused to avoid overwriting while typing
                
                 // 1. อัปเดตดอกเบี้ย (มีเช็ค activeElement เพื่อไม่ให้กวนตอนพิมพ์)
const elInterest = document.getElementById('new-interest-rate');
if (elInterest && document.activeElement.id !== 'new-interest-rate') {
    elInterest.value = config.interest_rate || 1.0;
}

// 4. อัปเดตตั้งค่ากิลด์ (เป้าหมายของเรา ✅)
const elGuildMax = document.getElementById('config-max-guild-members');
if (elGuildMax && document.activeElement.id !== 'config-max-guild-members') {
    elGuildMax.value = config.max_guild_members || 0;
}

const elGuildCool = document.getElementById('config-guild-cooldown');
if (elGuildCool && document.activeElement.id !== 'config-guild-cooldown') {
    elGuildCool.value = config.guild_rule_cooldown || 0;
}

const elGuildFee = document.getElementById('config-guild-fee');
if (elGuildFee && document.activeElement.id !== 'config-guild-fee') {
    elGuildFee.value = config.guild_rule_fee || 0;
}
                 renderBankList(false); // Trigger update for teacher view
            } else if (userRole === 'student') {
                 renderStudentDashboard(); // Trigger update for student view
            }
        } else {
            if (userRole === 'teacher') {
                setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'school_settings'), { 
                    interest_rate: 1.0, 
                    deduct_rate: 0, 
                    clear_rate: 0
                }, { merge: true });
            }
        }
    }, onError));

    unsubscribers.push(onSnapshot(collections.quests(), (snapshot) => {
        quests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (userRole === 'teacher') renderQuests(); // สร้างฟังก์ชันนี้ด้านล่าง
    }, onError));

    unsubscribers.push(onSnapshot(collections.guilds(), (snapshot) => {
    guilds = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if(userRole === 'teacher') {renderGuildsDashboard();
    renderStudentList(false);
    renderBankList(false);}
    else if (userRole === 'student') {
            // ✅ เพิ่มบรรทัดนี้: เมื่อข้อมูลกิลด์มาถึง ให้หน้าจอนักเรียนคำนวณใหม่ทันที
            renderStudentDashboard(); 
        }
}, onError));

    subscribeToStocks();

}

// --- UTILS ---

// Helper to format Firestore timestamp safely
function formatFirestoreTimestamp(timestamp) {
    if (!timestamp) return 'กำลังบันทึก...';
    
    // Case 1: Firestore Timestamp object (has toDate)
    if (typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toLocaleString('th-TH');
    }
    
    // Case 2: Standard object with seconds (from previous code assumption)
    if (timestamp.seconds) {
        return new Date(timestamp.seconds * 1000).toLocaleString('th-TH');
    }
    
    // Case 3: Native Date object
    if (timestamp instanceof Date) {
        return timestamp.toLocaleString('th-TH');
    }
    
    // Case 4: Number (millis)
    if (typeof timestamp === 'number') {
        return new Date(timestamp).toLocaleString('th-TH');
    }

    return '-';
}



window.switchTab = (tabName) => {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById('content-' + tabName);
    if(target) target.classList.remove('hidden');
    
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('border-red-500', 'text-red-600');
        btn.classList.add('border-transparent', 'text-gray-500');
    });
    const activeBtn = document.getElementById('tab-' + tabName);
    if(activeBtn) {
        activeBtn.classList.remove('border-transparent', 'text-gray-500');
        activeBtn.classList.add('border-red-500', 'text-red-600');
    }
    if (tabName === 'stocks') {
        renderStockMarket();
    }
    if (tabName === 'teacher-stocks') {
        renderTeacherStockControl();
    }
    if (tabName === 'student-guild') renderStudentGuild();
    renderBuffRulesSettings();


    
};

function sortList(list, col, asc) {
    return list.sort((a, b) => {
        let valA = a[col];
        let valB = b[col];
        
        // Handle numeric strings
        if (!isNaN(parseFloat(valA)) && isFinite(valA)) valA = parseFloat(valA);
        if (!isNaN(parseFloat(valB)) && isFinite(valB)) valB = parseFloat(valB);
        
        // Handle Thai sort
        if (typeof valA === 'string') return asc ? valA.localeCompare(valB, 'th') : valB.localeCompare(valA, 'th');
        
        if (valA < valB) return asc ? -1 : 1;
        if (valA > valB) return asc ? 1 : -1;
        return 0;
    });
}

window.sortStudents = (col) => {
    if (sortState.student.col === col) {
        sortState.student.asc = !sortState.student.asc;
    } else {
        sortState.student.col = col;
        sortState.student.asc = true;
    }
    renderStudentList();
};

window.sortBank = (col) => {
    if (sortState.bank.col === col) {
        sortState.bank.asc = !sortState.bank.asc;
    } else {
        sortState.bank.col = col;
        sortState.bank.asc = true;
    }
    renderBankList();
};

// Updated wrapper to handle search reset
window.filterStudents = () => {
    paginationState.home = 1;
    renderStudentList();
};

// ฟังก์ชันช่วยคำนวณเวลาที่เหลือเป็นข้อความ (เช่น "2 ชม. 30 น.")
function getRemainingTimeText(endTime) {
    if (!endTime) return null;
    
    let end = endTime;
    // แปลง Timestamp ของ Firestore ให้เป็น Milliseconds
    if (typeof end.toMillis === 'function') end = end.toMillis();
    else if (end instanceof Date) end = end.getTime();
    else if (end.seconds) end = end.seconds * 1000;

    const diff = end - Date.now();
    if (diff <= 0) return null; // หมดเวลาแล้ว

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 48) return Math.ceil(hours / 24) + ' วัน'; // นานกว่า 2 วัน บอกเป็นวัน
    if (hours > 0) return `${hours} ชม. ${minutes} น.`;
    return `${minutes} นาที`;
}

// ==========================================
// 👨‍🎓 Render รายชื่อนักเรียน (Pagination ใหม่)
// ==========================================
window.renderStudentList = (resetPage = true) => {
    allStudents = students;
    
    // 🔥 แก้ไข 1: ใช้ Global Pagination State
    if (!window.paginationState) window.paginationState = { student: 1 };
    if (resetPage) window.paginationState.student = 1;

    const tbody = document.getElementById('student-list');
    const filter = document.getElementById('search-input').value.toLowerCase();
    
    // กรองข้อมูล (Logic เดิม)
    let filtered = students.filter(s => {
        const gName = s.guild_id ? (guilds.find(g => g.id === s.guild_id)?.name || '') : '';
        return s.full_name.toLowerCase().includes(filter) || 
        s.student_id.includes(filter) ||
        (s.class_name && s.class_name.toLowerCase().includes(filter)) ||
        gName.toLowerCase().includes(filter);
    });

    if (sortState.student.col) {
        filtered = sortList(filtered, sortState.student.col, sortState.student.asc);
    }
    
    document.getElementById('student-count') && (document.getElementById('student-count').textContent = filtered.length);

    // ==========================================
    // 🔥 แก้ไข 2: Logic ตัดแบ่งหน้า (Slicing) แบบใหม่
    // ==========================================
    const perPage = window.itemsPerPage || 10;
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / perPage) || 1;

    // ป้องกันเลขหน้าเกินจริง
    if (window.paginationState.student > totalPages) window.paginationState.student = totalPages;
    if (window.paginationState.student < 1) window.paginationState.student = 1;

    const currentPage = window.paginationState.student;
    const startIndex = (currentPage - 1) * perPage;
    
    // ตัดข้อมูลที่จะแสดง
    const paginatedData = filtered.slice(startIndex, startIndex + perPage);

    // ==========================================

    
    // Sync Checkbox
    const selectAllCheckbox = document.getElementById('select-all');
    if(selectAllCheckbox) {
        const allOnPageSelected = paginatedData.length > 0 && paginatedData.every(s => selectedStudentIds.has(s.id));
        selectAllCheckbox.checked = allOnPageSelected;
    }

    const baseRate = (config && config.interest_rate) ? config.interest_rate : 1.0;

    // วาดตาราง (ใช้ paginatedData แทน)
    tbody.innerHTML = paginatedData.map(s => {
        // --- 🏰 1. ข้อมูลกิลด์ ---
        let guildBadge = '';
        let guildBonus = 0;
        let guildDiscount = 0;
        let guildBoost = 0;

        if (s.guild_id) {
            const g = allGuilds.find(x => x.id === s.guild_id);
            if (g) {
                if (g.buff_interest) guildBonus = parseFloat(g.buff_interest);
                const activeBuffs = getGuildActiveBuffs(g.id); 
                if(activeBuffs.discount) guildDiscount = parseFloat(activeBuffs.discount);
                if(activeBuffs.point_boost) guildBoost = parseFloat(activeBuffs.point_boost);

                guildBadge = `<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200 cursor-help" title="กิลด์ ${g.name} (ดอกเบี้ย +${(guildBonus).toFixed(2)}%, ลด ${guildDiscount}%, บูสต์ +${guildBoost}%)">${g.icon}</span>`;
            }
        }

        // --- 🕒 2. คำนวณเวลาและค่าบัฟส่วนตัว ---
        let buffBadgesHtml = '';
        const interestTime = getRemainingTimeText(s.special_interest_end);
        const couponIntTime = getRemainingTimeText(s.buff_interest_end); 

        const val1 = interestTime ? parseFloat(s.special_interest_rate || 0) : 0;
        const val2 = couponIntTime ? parseFloat(s.buff_interest_val || 0) : 0;

        let personalInterest = val1 + val2;
        const showIntTime = couponIntTime || interestTime;
        if (personalInterest > 0 && showIntTime) {
            buffBadgesHtml += `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap" title="บัฟส่วนตัว: ดอกเบี้ย +${personalInterest}% เหลือ ${showIntTime}">📈 ${showIntTime}</span>`;
        }

        const discountTime = getRemainingTimeText(s.buff_discount_end);
        let personalDiscount = discountTime ? parseFloat(s.buff_discount_val || 0) : 0;
        if (discountTime) {
            buffBadgesHtml += `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700 border border-red-200 whitespace-nowrap" title="บัฟส่วนตัว: ลดราคา ${personalDiscount}% เหลือ ${discountTime}">🏷️ ${discountTime}</span>`;
        }

        const boostTime = getRemainingTimeText(s.buff_points_end);
        let personalBoost = boostTime ? parseFloat(s.buff_points_val || 0) : 0;
        if (boostTime) {
            buffBadgesHtml += `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap" title="บัฟส่วนตัว: บูสต์แต้ม +${personalBoost}% เหลือ ${boostTime}">🚀 ${boostTime}</span>`;
        }

        // --- 🏦 3. คำนวณดอกเบี้ยรวม ---
        let finalRate = baseRate + guildBonus + personalInterest;
        let rateTag = '';
        if (finalRate > baseRate) {
            let icon = '🔥';
            let colorClass = 'bg-green-50 text-green-700 border-green-200';
            
            if (personalInterest > 0) { 
                icon = '🌟'; 
                colorClass = 'bg-purple-50 text-purple-700 border-purple-200'; 
            } 
            else if (guildBonus > 0) { 
                icon = '🛡️'; 
            } 

            const tooltipTitle = `รวม: ${finalRate.toFixed(2)}% (พื้นฐาน ${(baseRate).toFixed(2)}% + กิลด์ ${(guildBonus).toFixed(2)}% + ส่วนตัว ${(personalInterest).toFixed(2)}%)`;

            rateTag = `
            <div class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border ${colorClass} cursor-help" title="${tooltipTitle}">
                <span class="text-[10px]">${icon}</span>
                <span class="text-[10px] font-bold">+${(finalRate - baseRate).toFixed(2)}%</span>
            </div>`;
        }

        // --- 🎒 4. ไอเทม ---
        const inv = s.inventory || []; 
        const totalItems = inv.length;
        const unopenedBoxCount = inv.filter(i => i.type === 'gacha_box').length;
        let itemBadge = '';
        if (totalItems > 0) {
            if (unopenedBoxCount > 0) {
                itemBadge = `<span class="ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200 font-bold animate-pulse cursor-help" title="มีกล่องสุ่ม ${unopenedBoxCount} กล่อง">🎁 ${unopenedBoxCount}</span>`;
            } else {
                itemBadge = `<span class="ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 cursor-help" title="ไอเทม ${totalItems} ชิ้น">🎒 ${totalItems}</span>`;
            }
        }

        const pendingInterest = calculatePendingInterest(s);
        const totalWithdrawable = (s.bank_points || 0) + pendingInterest;
        const isSelected = selectedStudentIds.has(s.id);
        const rowClass = isSelected ? 'bg-green-50 border-l-4 border-l-green-500' : 'hover:bg-gray-50 border-l-4 border-l-transparent';

        // 🔥🔥🔥 [แทรกใหม่ 1] เตรียม HTML สำหรับสกิน 🔥🔥🔥
        const frameUrl = s.equipped_frame || ''; 
        const bgUrl = s.equipped_bg || '';

        // สร้าง HTML กรอบรูป (ครอบตัว Checkbox เดิม)
        const avatarHtml = `
        <div class="relative w-10 h-10 flex items-center justify-center mx-auto">
            ${frameUrl ? `<img src="${frameUrl}" class="absolute inset-0 w-full h-full object-contain z-20 pointer-events-none drop-shadow-md scale-125">` : ''}
            
            <div class="w-5 h-5 rounded border flex items-center justify-center transition-all z-10 
                ${isSelected ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 bg-white'}">
                ${isSelected ? '✓' : ''}
            </div>
        </div>`;

        // สร้าง Style พื้นหลังชื่อ (ถ้ามี)
        const nameBgStyle = bgUrl ? `background-image: url('${bgUrl}'); background-size: cover; background-position: center; color: white; text-shadow: 1px 1px 2px black; padding: 2px 6px; border-radius: 6px;` : '';
        // ----------------------------------------------------
        return `
        <tr onclick="toggleSelectStudent('${s.id}')" class="cursor-pointer transition-all border-b last:border-b-0 group ${rowClass}">
            <td class="px-2 py-3 text-center">
            ${avatarHtml}
            </td>
            <td class="px-2 py-3 text-xs text-gray-500 font-mono">${s.student_id}</td>
            <td class="px-2 py-3">
                <div class="flex flex-col items-start gap-1">
                    <span class="font-bold text-gray-800 text-sm flex items-center flex-wrap gap-1 transition-all" style="${nameBgStyle}">
                        ${s.full_name} ${guildBadge} ${itemBadge}
                    </span>
                    <div class="flex flex-wrap gap-1">
                        ${rateTag}
                        ${buffBadgesHtml}
                    </div>
                </div>
            </td>
            <td class="px-2 py-3 text-center">
                <span class="font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full text-xs">${Math.floor(s.points).toLocaleString()}</span>
            </td>
            <td class="px-2 py-3 text-center text-indigo-700 font-mono text-xs font-bold">
                ${Math.floor(s.bank_points || 0).toLocaleString()}
            </td>
            <td class="px-2 py-3 text-center text-green-600 font-mono text-xs">
                +${Math.floor(pendingInterest).toLocaleString()}
            </td>
            <td class="px-2 py-3 text-center text-emerald-700 font-bold text-sm">
                ${Math.floor(totalWithdrawable).toLocaleString()}
            </td>
            <td class="px-2 py-3 text-center">
                <div class="flex flex-col items-center justify-center">
                    <div class="flex items-center justify-center">
                        <span class="font-bold text-yellow-600 text-lg">${s.warning_cards || 0}</span>
                    </div>
                    ${(s.pending_points || 0) > 0 ? `<div class="text-[10px] text-red-500 font-bold mt-1 bg-red-50 px-1 rounded border border-red-100">🔒 อายัด ${s.pending_points} แต้ม</div>` : ''}
                </div>
            </td>
            <td class="px-2 py-3 text-center" onclick="event.stopPropagation()">
                <div class="flex items-center justify-center gap-1">
                    <button onclick="openBankModal('${s.id}')" class="p-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg border border-green-200 transition-colors" title="ธุรกรรมธนาคาร">🏦</button>
                    <button onclick="openDonateGuildModal('${s.id}')" class="p-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors" title="บริจาคเข้ากิลด์">🤝</button>
                    <button onclick="openAdminInventory('${s.id}')" class="p-1.5 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors" title="จัดการกระเป๋า (ลบของ)">🎒</button>
                    <button onclick="openEditStudentModal('${s.id}')" class="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="แก้ไข">✏️</button>
                </div>
            </td>
        </tr>`;
    }).join('');
    
    // 🔥 แก้ไข 3: เรียกปุ่มควบคุมแบบใหม่ (ไม่ต้องส่ง optionsHtml เองแล้ว)
    if (typeof renderPaginationControls === 'function') {
        const pContainer = document.getElementById('pagination-home');
        if(pContainer) {
            // ใช้ type 'student' ให้ตรงกับที่ตั้งไว้ใน Global State
            pContainer.innerHTML = renderPaginationControls(totalItems, 'student');
        }
    }
    
    renderPunishmentList();
    updateBulkUI();
};

window.renderStudentDashboard = (student) => {
    if (!currentStudentData) return;
    const s = currentStudentData;
    const interest = calculatePendingInterest(s);
    const totalWithdrawable = (s.bank_points || 0) + interest;

    document.getElementById('std-dash-name').textContent = s.full_name;
    document.getElementById('std-dash-class').textContent = `เลขประจำตัว: ${s.student_id} | ชั้น: ${s.class_name}`;
    document.getElementById('std-dash-points').textContent = Math.floor(s.points).toLocaleString();
    document.getElementById('std-dash-bank').textContent = Math.floor(totalWithdrawable).toLocaleString();
    document.getElementById('std-dash-interest').textContent = Math.floor(interest).toLocaleString();
    const warningSection = document.getElementById('std-warning-section');
    const warningCount = s.warning_cards || 0;

    if (warningCount > 0) {
        warningSection.classList.remove('hidden'); // โชว์แผงเตือน
        
        // 1. อัปเดตจำนวนใบเตือน
        document.getElementById('std-dash-warning-count').textContent = warningCount;
        
        // 2. อัปเดตแต้มที่อายัด (Pending)
        const pendingBox = document.getElementById('std-dash-pending-box');
        if ((s.pending_points || 0) > 0) {
            pendingBox.classList.remove('hidden');
            document.getElementById('std-dash-pending-points').textContent = s.pending_points.toLocaleString();
        } else {
            pendingBox.classList.add('hidden');
        }

        // 3. อัปเดตรายการภารกิจ
        const missionContainer = document.getElementById('std-dash-missions');
        if (s.active_missions && s.active_missions.length > 0) {
            missionContainer.innerHTML = s.active_missions.map(m => `
                <div class="flex items-start gap-2 text-sm text-gray-700 bg-white p-2 rounded border border-yellow-100 shadow-sm">
                    <span class="text-red-500 mt-0.5">▫️</span>
                    <span>${m}</span>
                </div>
            `).join('');
        } else {
            missionContainer.innerHTML = `
                <div class="text-center py-2 text-yellow-600 text-sm italic bg-yellow-50/50 rounded-lg border border-dashed border-yellow-300">
                    ยังไม่ได้รับภารกิจ (ติดต่อครูประจำชั้น)
                </div>`;
        }

    } else {
        warningSection.classList.add('hidden'); // ซ่อนแผงเตือน (ถ้าเป็นเด็กดี)
    }

    
    const myHistory = history.filter(h => h.student_id === s.id).slice(0, 5);
    document.getElementById('std-history-list').innerHTML = myHistory.length ? myHistory.map(h =>
    {
    const isPositive = ['add_points', 'interest', 'quest_complete', 'bank_withdraw', 'refund'].includes(h.type);
    
    return `
        <div class="flex justify-between items-start border-b border-gray-50 pb-2 last:border-0">
            <div>
                <p class="font-medium text-gray-800">${h.action}</p>
                <p class="text-xs text-gray-400">${formatFirestoreTimestamp(h.timestamp)}</p>
            </div>
            <span class="font-bold ${isPositive ? 'text-green-600' : 'text-red-500'}">
                ${isPositive ? '+' : '-'}${Math.floor(Math.abs(h.amount)).toLocaleString()}
            </span>
        </div>
    `;
}).join('') : '<p class="text-gray-400 text-center py-2">ยังไม่มีประวัติ</p>';
    renderStudentInventory(s); // เรียกฟังก์ชันแสดงกระเป๋า
    renderStreakWidget(currentStudentData); // แสดง Widget เช็คชื่อ
    
}


// Exposed to window for inline HTML calls
window.renderBankList = () => {
    return;
};

window.sortRewards = (field) => {
    if (currentRewardSort.field === field) {
        // ถ้ากดปุ่มเดิม ให้สลับ Asc <-> Desc
        currentRewardSort.dir = currentRewardSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        // ถ้ากดปุ่มใหม่ ให้เริ่มที่ Asc
        currentRewardSort.field = field;
        currentRewardSort.dir = 'asc';
    }
    renderRewards(); // วาดตารางใหม่
};

function renderRewards() {
    const tbody = document.getElementById('rewards-list');
    const headerRow = document.querySelector('#rewards-table-container thead tr');
    const generalRewards = rewards.filter(r => r.shop_type !== 'guild');
    
    // 1. อัปเดตหัวตารางให้กดเรียงได้ (Inject HTML Headers)
    if (headerRow) {
        const getSortIcon = (f) => currentRewardSort.field === f ? (currentRewardSort.dir === 'asc' ? '▲' : '▼') : '↕';
        headerRow.innerHTML = `
            <th class="px-4 py-3 text-center w-20">รูป</th>
            <th class="px-4 py-3 text-left cursor-pointer hover:bg-amber-100 select-none" onclick="sortRewards('category')">หมวดหมู่ <span class="text-xs text-gray-400">${getSortIcon('category')}</span></th>
            <th class="px-4 py-3 text-left cursor-pointer hover:bg-amber-100 select-none" onclick="sortRewards('name')">ชื่อรางวัล <span class="text-xs text-gray-400">${getSortIcon('name')}</span></th>
            <th class="px-4 py-3 text-center cursor-pointer hover:bg-amber-100 select-none" onclick="sortRewards('points')">ราคา <span class="text-xs text-gray-400">${getSortIcon('points')}</span></th>
            <th class="px-4 py-3 text-center cursor-pointer hover:bg-amber-100 select-none" onclick="sortRewards('stock')">สต็อก <span class="text-xs text-gray-400">${getSortIcon('stock')}</span></th>
            <th class="px-4 py-3 text-center">จัดการ</th>
        `;
    }

    if (userRole === 'teacher' && tbody) {
        // 2. เตรียมข้อมูลและเรียงลำดับ
        let displayRewards = [...generalRewards];

        displayRewards.sort((a, b) => {
            let valA = a[currentRewardSort.field];
            let valB = b[currentRewardSort.field];

            // จัดการค่า Null/Undefined
            if (currentRewardSort.field === 'category') {
                valA = valA || 'ทั่วไป';
                valB = valB || 'ทั่วไป';
            }

            if (valA < valB) return currentRewardSort.dir === 'asc' ? -1 : 1;
            if (valA > valB) return currentRewardSort.dir === 'asc' ? 1 : -1;
            return 0;
        });

        // 3. วาดแถวข้อมูล
        tbody.innerHTML = displayRewards.map(r => {
            const stockText = (r.stock === -1 || r.stock === '-1') ? '∞' : r.stock;
            const isGain = r.points < 0;
            const pointsDisplay = isGain ? `+${Math.abs(r.points)}` : r.points;
            const pointsClass = isGain ? 'text-green-600' : 'text-amber-600';
            
            const isActive = r.is_active !== false;
            const opacityClass = isActive ? '' : 'opacity-50 grayscale bg-gray-50';
            const statusBadge = isActive ? '' : '<span class="ml-2 text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full border border-red-200">ปิด</span>';

            return `
            <tr class="hover:bg-amber-50 group border-b last:border-0 ${opacityClass}">
                <td class="px-4 py-3 text-center">
                    <div class="h-10 w-10 mx-auto bg-gray-100 rounded flex items-center justify-center overflow-hidden">
                         ${r.image ? `<img src="${r.image}" class="w-full h-full object-cover">` : `<span class="text-lg">🎁</span>`}
                    </div>
                </td>
                <td class="px-4 py-3">
                    <span class="inline-block px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md border border-gray-200">
                        ${r.category || 'ทั่วไป'}
                    </span>
                </td>
                <td class="px-4 py-3 font-medium text-gray-800">
                    ${r.name} ${statusBadge}
                </td>
                <td class="px-4 py-3 text-center font-bold ${pointsClass}">${(pointsDisplay).toLocaleString()}</td>
                <td class="px-4 py-3 text-center font-mono text-gray-500">${stockText}</td>
                <td class="px-4 py-3 text-center">
                    <button onclick="openEditRewardModal('${r.id}')" class="text-blue-600 hover:text-blue-800 font-bold text-sm px-2">แก้ไข</button>
                    <button onclick="confirmDeleteReward('${r.id}')" class="text-red-500 hover:text-red-700 font-bold text-sm px-2">ลบ</button>
                </td>
            </tr>`;
        }).join('');

        document.getElementById('rewards-table-container').classList.remove('hidden');
        document.getElementById('rewards-grid-container').classList.add('hidden');
    }
    
    // Student view (Grid)
    const grid = document.getElementById('rewards-grid');
    if (userRole === 'student' && grid) {
        grid.innerHTML = generalRewards.map(r => {
            // --- 🟢 ส่วนที่แก้: Logic แสดงผลฝั่งนักเรียน ---
            const isGain = r.points < 0; // ถ้าแต้มติดลบ แปลว่า "แจกแต้ม"
            
            const canAfford = isGain ? true : (currentStudentData ? currentStudentData.points >= r.points : false);
            const isUnlimited = r.stock === -1;
            const hasStock = isUnlimited || r.stock > 0;
            
            // ถ้าเป็นงาน (แจกแต้ม) ไม่ต้องเช็ค canAfford (แต้มพอไหม) เช็คแค่ของหมดไหม
            const disabled = isGain ? !hasStock : (!canAfford || !hasStock);
            
            let stockLabel = isUnlimited ? 'ไม่จำกัด' : `${r.stock} ชิ้น`;
            
            // ปรับ UI ตามประเภท (งาน vs รางวัล)
            const pointsLabel = isGain ? `+${Math.abs(r.points)} แต้ม` : `💵 ${(r.points).toLocaleString()} แต้ม`;
            const pointsBg = isGain ? 'bg-green-100 text-green-700' : 'bg-amber-50 text-amber-600';
            const btnText = disabled ? (hasStock ? 'แต้มไม่พอ' : 'หมดแล้ว') : (isGain ? 'ส่งงาน / รับแต้ม' : 'แลกรางวัล โปรดติดต่อครู');
            const btnColor = disabled ? 'bg-gray-300 cursor-not-allowed' : (isGain ? 'bg-indigo-600 hover:bg-indigo-700 shadow-sm' : 'bg-green-500 hover:bg-green-600 shadow-sm');
            // -----------------------------------------------

            return `
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden relative group hover:shadow-md transition-shadow">
                <div class="h-32 bg-gray-100 flex items-center justify-center overflow-hidden">
                    ${r.image ? `<img src="${r.image}" class="w-full h-full object-cover">` : `<span class="text-4xl">${isGain ? '📝' : '🎁'}</span>`}
                </div>
                <div class="p-4">
                    <h3 class="font-bold text-gray-800 text-lg">${r.name}</h3>
                    <div class="flex justify-between items-center mt-2 mb-2">
                        <span class="${pointsBg} font-bold px-2 py-1 rounded-md text-sm">${pointsLabel}</span>
                        <span class="text-gray-400 text-xs">เหลือ ${stockLabel}</span>
                    </div>
                    <button onclick="selectRewardForRedeem('${r.id}')" ${disabled ? 'disabled' : ''} class="w-full mt-1 py-2 rounded-lg text-sm font-bold text-white transition-colors ${btnColor}">
                        ${btnText}
                    </button>
                </div>
            </div>
            `;
        }).join('');
        
        document.getElementById('rewards-table-container').classList.add('hidden');
        document.getElementById('rewards-grid-container').classList.remove('hidden');
    }
}

// ==========================================
// 📜 แสดงประวัติ (History) - เวอร์ชันสมบูรณ์ (Filter + Pagination)
// ==========================================

// ตั้งค่า Pagination State (ถ้ายังไม่มี)
window.renderHistory = (resetPage = true) => {
    // ✅ 1. ตั้งค่า State ถ้ายังไม่มี
    if (!window.paginationState) window.paginationState = { history: 1 };
    
    // รีเซ็ตหน้า ถ้ามีการค้นหาใหม่ (User พิมพ์ search)
    if (resetPage) window.paginationState.history = 1;

    const tbody = document.getElementById('history-list');
    
    // ดึงค่าจาก HTML
    const searchInput = document.getElementById('history-search-input') || document.getElementById('history-search'); 
    const filterInput = document.getElementById('history-action-filter');

    const searchText = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const searchType = filterInput ? filterInput.value : '';

    if (!tbody) return;

    // ✅ 2. เลือกแหล่งข้อมูลที่ปลอดภัย (ป้องกัน Error ชื่อตัวแปร)
    let sourceData = [];
    if (typeof history !== 'undefined' && Array.isArray(history)) sourceData = history;
    else if (typeof historyData !== 'undefined' && Array.isArray(historyData)) sourceData = historyData;

    // 3. กรองข้อมูล (Logic เดิมของคุณ)
    let filtered = sourceData.filter(h => { 
        
        // --- ส่วนที่ 1: เช็คคำค้นหา (ชื่อ/รหัส) ---
        let searchableId = String(h.student_id || '');
        const foundStudent = students.find(s => s.id === h.student_id);
        if (foundStudent) searchableId = String(foundStudent.student_id || '');

        const name = (h.student_name || '').toLowerCase();
        const reason = (h.reason || h.details || '').toLowerCase(); 
        
        const isTextMatch = (
            searchText === '' || 
            name.includes(searchText) || 
            searchableId.includes(searchText) ||
            reason.includes(searchText)
        );

        // --- ส่วนที่ 2: เช็คประเภท ---
        let isTypeMatch = false;
        const type = h.type || '';
        const action = h.action || '';

        if (searchType === '') {
            isTypeMatch = true;
        } 
        else if (searchType === 'check_in') {
            isTypeMatch = (type === 'daily_streak');
        }
        else if (searchType === 'gacha') {
            isTypeMatch = (
                type === 'gacha' || type === 'gacha_custom' || type === 'gacha_refund' ||
                action.includes('กล่องสุ่ม') || action.includes('Gacha')
            );
        }
        else if (searchType === 'punishment') {
            isTypeMatch = (type === 'warning_card_log' || type === 'punishment' || type === 'penalty');
        }
        else if (searchType === 'deduct_points') {
            isTypeMatch = (type === 'remove_points' || type === 'deduct_points');
        }
        else if (searchType === 'create_guild') {
            isTypeMatch = (type === 'create_guild' || action.includes('สร้างกิลด์'));
        }
        else if (searchType === 'quest_complete') {
            isTypeMatch = (
                type === 'quest_complete' || type === 'mission' || type === 'job' || 
                action.includes('ภารกิจ') || action.includes('Quest') || action.includes('ตอบคำถาม')
            );
        }
        else if (searchType === 'bank') { 
             isTypeMatch = type.includes('bank');
        }
        else if (searchType === 'guild') { 
             isTypeMatch = type.includes('guild');
        }
        else {
            isTypeMatch = (type === searchType);
        }

        return isTextMatch && isTypeMatch; 
    });

    // 4. เรียงลำดับ (Logic เดิม)
    filtered.sort((a, b) => {
        const tA = a.timestamp ? (a.timestamp.seconds || new Date(a.timestamp).getTime()/1000) : 0;
        const tB = b.timestamp ? (b.timestamp.seconds || new Date(b.timestamp).getTime()/1000) : 0;
        return tB - tA;
    });

    // ===============================================
    // 🔥🔥🔥 5. ส่วนที่แก้ไข: เชื่อมระบบ Pagination ใหม่ 🔥🔥🔥
    // ===============================================
    
    // ใช้ตัวแปร Global (window.itemsPerPage) แทนค่าคงที่
    const perPage = window.itemsPerPage || 10; 
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / perPage) || 1;
    
    // ป้องกันเลขหน้าเกินจำนวนจริง
    if (window.paginationState.history > totalPages) window.paginationState.history = totalPages;
    if (window.paginationState.history < 1) window.paginationState.history = 1;

    const currentPage = window.paginationState.history;
    
    // ตัดแบ่งข้อมูล
    const startIndex = (currentPage - 1) * perPage;
    const paginatedData = filtered.slice(startIndex, startIndex + perPage);

    // ===============================================

    // 6. แสดงผลลงตาราง
    if (paginatedData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-400">ไม่พบข้อมูลประวัติ</td></tr>`;
        // เคลียร์ปุ่มกดทิ้ง ถ้าไม่มีข้อมูล
        if(document.getElementById('pagination-history')) document.getElementById('pagination-history').innerHTML = '';
        return;
    }

    tbody.innerHTML = paginatedData.map(h => {
        // แปลงเวลา
        let dateStr = '-';
        if (h.timestamp) {
            const d = (typeof h.timestamp.toDate === 'function') ? h.timestamp.toDate() : new Date(h.timestamp);
            dateStr = d.toLocaleString('th-TH', { 
                day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' 
            });
        }

        const expenseTypes = [
            'buy_item', 'bank_deposit', 'deposit', 'punishment', 'penalty',
            'deduct_points', 'remove_points', 'create_guild', 
            'gacha', 'clear_red_card', 'redeem', 'guild_use_item'
        ];

        const safeAmount = h.amount || 0;
        const safeAction = h.action || '';
        const safeType = h.type || '';
        
        const isNegative = expenseTypes.includes(safeType) || safeAmount < 0 || safeAction.includes('ถอน');
        
        const isPositive = (!isNegative || safeType === 'bank_withdraw' || safeType === 'withdraw') && !(safeAmount < 0 && safeType !== 'bank_withdraw');

        const amountVal = Math.floor(Math.abs(safeAmount)).toLocaleString();
        
        const amountHtml = !isPositive 
            ? `<span class="text-red-600 font-bold">-${amountVal}</span>` 
            : `<span class="text-green-600 font-bold">+${amountVal}</span>`;

        let displayStudentID = '-';
        const foundStudent = students.find(s => s.id === h.student_id);
        if (foundStudent) displayStudentID = foundStudent.student_id || '-';

        return `
        <tr class="hover:bg-gray-50 border-b last:border-b-0 text-sm group transition-colors">
            <td class="px-4 py-3 text-gray-500 whitespace-nowrap">${dateStr}</td>
            <td class="px-4 py-3 font-bold text-gray-700">
                ${h.student_name || 'ไม่ระบุชื่อ'} <br>
                <span class="text-[10px] text-gray-400 font-normal">${displayStudentID}</span>
            </td>
            <td class="px-4 py-3">
                <div class="flex flex-col">
                    <span class="font-bold text-gray-800">${safeAction}</span>
                    <span class="text-xs text-gray-400">${h.reason || h.details || ''}</span>
                </div>
            </td>
            <td class="px-4 py-3 text-right text-base">${amountHtml}</td>
            <td class="px-4 py-3 text-center">
                <button onclick="deleteHistoryItem('${h.id}')" class="text-gray-300 hover:text-red-500 p-1 transition-colors bg-white rounded-full hover:bg-red-50" title="ลบรายการ">🗑️</button>
            </td>
        </tr>`;
    }).join('');

    // 🔥 7. เรียกฟังก์ชันวาดปุ่มควบคุม (Render Controls)
    // ส่งแค่ totalItems กับ 'history' ก็พอ เพราะฟังก์ชันใหม่มันดึง itemsPerPage จาก Global เอง
    if (typeof renderPaginationControls === 'function') {
        document.getElementById('pagination-history').innerHTML = renderPaginationControls(totalItems, 'history');
    }
};

// ==========================================
// 🔧 Helper Functions (ใส่ไว้ท้ายไฟล์ app.js)
// ==========================================

// ฟังก์ชันลบประวัติ (Stub)
window.deleteHistoryItem = async (id) => {
    const confirm = await Swal.fire({
        title: 'ยืนยันลบประวัติ?',
        text: "รายการนี้จะหายไปถาวร แต่จะไม่กระทบแต้มปัจจุบัน",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'ลบเลย'
    });

    if (confirm.isConfirmed) {
        try {
            await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'history', id));
            showToast('ลบรายการเรียบร้อย');
            // Data จะ update เองผ่าน Snapshot หรือให้เรียก renderHistory()
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'ลบไม่สำเร็จ', 'error');
        }
    }
};

// ฟังก์ชันวาดปุ่ม Pagination
window.renderPaginationControls = (totalItems, context, perPage = 10) => {
    const container = document.getElementById(`pagination-${context}`);
    if (!container) return;

    const totalPages = Math.ceil(totalItems / perPage);
    const currentPage = paginationState[context];

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = `
    <div class="flex justify-center items-center space-x-2 mt-4">
        <button onclick="changePage('${context}', -1)" ${currentPage === 1 ? 'disabled class="opacity-30 cursor-not-allowed"' : 'class="hover:bg-gray-200"'} class="px-3 py-1 rounded border text-sm">◀</button>
        <span class="text-sm font-bold text-gray-600">หน้า ${currentPage} / ${totalPages}</span>
        <button onclick="changePage('${context}', 1)" ${currentPage === totalPages ? 'disabled class="opacity-30 cursor-not-allowed"' : 'class="hover:bg-gray-200"'} class="px-3 py-1 rounded border text-sm">▶</button>
    </div>`;
    
    container.innerHTML = html;
};

/* ฟังก์ชันเปลี่ยนหน้า
window.changePage = (context, direction) => {
    paginationState[context] += direction;
    if (context === 'history') renderHistory(false); // false = ไม่ต้อง reset หน้า 1
};*/


// --- HELPER: CUSTOM CONFIRM MODAL ---
let pendingConfirmAction = null;
let pendingCancelAction = null;

window.showConfirmModal = (title, message, confirmCallback, cancelCallback = null) => {
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-message').textContent = message;
    pendingConfirmAction = confirmCallback;
    pendingCancelAction = cancelCallback;
    document.getElementById('confirmation-modal').classList.remove('hidden');
    document.getElementById('confirmation-modal').classList.add('flex');
};

window.closeConfirmModal = () => {
    if(pendingCancelAction) pendingCancelAction();
    document.getElementById('confirmation-modal').classList.add('hidden');
    document.getElementById('confirmation-modal').classList.remove('flex');
    pendingConfirmAction = null;
    pendingCancelAction = null;
};

window.executeConfirmAction = async () => {
    if (pendingConfirmAction) {
        await pendingConfirmAction();
    }
    document.getElementById('confirmation-modal').classList.add('hidden');
    document.getElementById('confirmation-modal').classList.remove('flex');
    pendingConfirmAction = null;
    pendingCancelAction = null;
};



// --- ACTIONS & LOGIC ---

// Config Saving (Auto-save)
async function saveConfig(key, value) {
    if (!auth.currentUser) return alert('Session หลุด! กรุณารีเฟรชหน้าจอ');
    if (!appId) return alert('App ID Not Found');
    
    try {
        // Force Path: artifacts/{appId}/public/data/config/school_settings
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'school_settings'), { [key]: value }, { merge: true });
    } catch (e) {
        console.error("Save config error:", e);
        alert('บันทึกการตั้งค่าไม่สำเร็จ: ' + e.message);
    }
}

// Attach these to onchange/onblur
window.savePunishmentRate = async () => {
    try {
        const val = parseInt(document.getElementById('points-per-red-card').value);
        await saveConfig('deduct_rate', val);
        showToast('บันทึกค่าปรับแต้มใบแดงเรียบร้อย!');
    } catch (e) {
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

window.saveClearRedCardRate = async () => {
    try {
        const val = parseInt(document.getElementById('points-to-clear-red-card').value);
        await saveConfig('clear_rate', val);
        showToast('บันทึกค่าล้างใบแดงเรียบร้อย!');
    } catch (e) {
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

window.handleInterestRateChange = () => {
    const newRate = parseFloat(document.getElementById('new-interest-rate').value);
    if(isNaN(newRate)) return;

    showConfirmModal('ยืนยันเปลี่ยนดอกเบี้ย', 'ระบบจะคำนวณดอกเบี้ยสะสมเข้าแต้มฝากให้นักเรียนทุกคนก่อนเปลี่ยนเรท ยืนยันหรือไม่?', async () => {
        const batch = writeBatch(db);
        let count = 0;
        
        students.forEach(s => {
          if (s.special_interest_end) {
              let endTime = s.special_interest_end;
              if (endTime && typeof endTime.toMillis === 'function') endTime = endTime.toMillis();
              // ถ้าโปรยังไม่หมดอายุ -> ข้าม (Skip)
              if (Date.now() <= endTime) return; 
          }
            const interest = calculatePendingInterest(s);
            const interestInt = Math.floor(interest);
            
            if (s.bank_points > 0 || interestInt > 0) {
                const newPrincipal = (s.bank_points || 0) + interestInt;
                const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
                
                batch.update(sRef, {
                    bank_points: newPrincipal,
                    bank_deposit_time: serverTimestamp() 
                });
                count++;
            }

        });
        
        try {
            await saveConfig('interest_rate', newRate);
            if (count > 0) await batch.commit();
            showToast('บันทึกดอกเบี้ยใหม่สำเร็จ!');
            document.getElementById('new-interest-rate').blur();
        } catch (e) {
            alert('เกิดข้อผิดพลาด: ' + e.message);
        }
    }, () => {
        // Revert value on cancel
        document.getElementById('new-interest-rate').value = config.interest_rate || 1.0;
    });
};

// Students
window.showAddStudentModal = () => document.getElementById('add-student-modal').classList.remove('hidden');
window.handleAddStudent = async (e) => {
    e.preventDefault();
    
    const stdId = document.getElementById('add-std-id').value.trim();
    // ถ้าระบุรหัสมาก็ใช้ ถ้าไม่ระบุให้ใช้เลขประจำตัวเป็นรหัส
    const password = document.getElementById('add-std-pass').value.trim() || stdId; 

    const data = {
        student_id: stdId,
        password: password, // ✅ บันทึกรหัสผ่าน
        full_name: document.getElementById('add-std-name').value,
        class_name: document.getElementById('add-std-class').value,
        points: 0,
        warning_cards: 0,
        bank_points: 0,
        bank_deposit_time: serverTimestamp(),
        redeemed_history: {} 
    };
    await addDoc(collections.students(), data);
    document.getElementById('add-student-modal').classList.add('hidden');
    e.target.reset();
    showToast(`เพิ่มนักเรียนสำเร็จ (รหัสผ่าน: ${password})`);
};

// CSV IMPORT LOGIC (NEW)
window.showImportCSVModal = () => document.getElementById('import-csv-modal').classList.remove('hidden');

window.handleCSVImport = async () => {
    const text = document.getElementById('import-csv-text').value.trim();
    if (!text) return alert('กรุณาวางข้อมูล CSV');
    
    const lines = text.split('\n');
    let successCount = 0;
    let batch = writeBatch(db);
    let batchCount = 0;
    
    for (let line of lines) {
        // Check headers or empty lines
        if (!line.trim() || line.includes('เลขประจำตัว')) continue;
        
        // Split by tab or comma
        const parts = line.split(/[\t,]+/).map(p => p.trim());
        if (parts.length < 2) continue; // Basic validation
        
        const [stdId, name, className, points, warnings] = parts;
        
        // Validate data
        if (!stdId || !name) continue;
        
        // Check existing
        const exists = students.some(s => s.student_id === stdId);
        if (exists) continue; // Skip existing for now or update? Let's skip to be safe.
        
        const newDocRef = doc(collections.students()); // New auto-id doc
        batch.set(newDocRef, {
            student_id: stdId,
            full_name: name,
            class_name: className || '-',
            points: parseInt(points) || 0,
            warning_cards: parseInt(warnings) || 0,
            bank_points: 0,
            bank_deposit_time: serverTimestamp(),
            redeemed_history: {}
        });
        
        successCount++;
        batchCount++;
        
        // Firestore limit is 500 per batch
        if (batchCount >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            batchCount = 0;
        }
    }
    
    if (batchCount > 0) await batch.commit();
    
    document.getElementById('import-csv-modal').classList.add('hidden');
    document.getElementById('import-csv-text').value = '';
    showToast(`นำเข้าสำเร็จ ${successCount} รายการ`);
};

window.openEditStudentModal = (id) => {
    const s = students.find(x => x.id === id);
    if(!s) return;
    document.getElementById('edit-std-doc-id').value = id;
    document.getElementById('edit-std-id').value = s.student_id;
    document.getElementById('edit-std-name').value = s.full_name;
    document.getElementById('edit-std-class').value = s.class_name;
    
    // เคลียร์ช่องรหัสผ่านเสมอ (ไม่ควรโชว์รหัสเก่า)
    if(document.getElementById('edit-std-pass')) {
        document.getElementById('edit-std-pass').value = '';
    }
    
    document.getElementById('edit-student-modal').classList.remove('hidden');
};

window.handleEditStudentSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-std-doc-id').value;
    const newPass = document.getElementById('edit-std-pass').value.trim();

    const updates = {
        student_id: document.getElementById('edit-std-id').value,
        full_name: document.getElementById('edit-std-name').value,
        class_name: document.getElementById('edit-std-class').value
    };

    // ✅ อัปเดตรหัสผ่านเฉพาะเมื่อมีการกรอกค่าใหม่
    if (newPass) {
        updates.password = newPass;
    }

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', id), updates);
    document.getElementById('edit-student-modal').classList.add('hidden');
    
    // เคลียร์ช่องรหัสผ่านเพื่อความปลอดภัย
    document.getElementById('edit-std-pass').value = '';
    
    showToast('แก้ไขข้อมูลเรียบร้อย ✅');
};

// Points & Red Card Modal
let currentPointAction = { id: null, type: null, isBulk: false, isRedCard: false };

window.openPointsModal = (id, type) => {
    currentPointAction = { id, type, isBulk: false, isRedCard: false };
    document.getElementById('points-modal-title').textContent = type === 'add' ? 'เพิ่มแต้ม' : 'ลดแต้ม';
    document.getElementById('points-input-label').textContent = 'จำนวนแต้ม';
    document.getElementById('selected-students-preview').innerHTML = ''; 
    document.getElementById('points-amount').value = '';
    document.getElementById('points-modal').classList.remove('hidden');
};

window.showBulkPointsModal = (action, isRedCard, singleId = null) => {
    currentPointAction = { 
        id: singleId, 
        type: action, 
        isBulk: !singleId, 
        isRedCard: isRedCard 
    };
    
    if (isRedCard) {
        document.getElementById('points-modal-title').textContent = action === 'add' ? 'เพิ่มใบแดง' : 'ลดใบแดง';
        document.getElementById('points-input-label').textContent = 'จำนวนใบแดง';
    } else {
        document.getElementById('points-modal-title').textContent = action === 'add' ? 'เพิ่มแต้ม' : 'ลดแต้ม';
        document.getElementById('points-input-label').textContent = 'จำนวนแต้ม';
    }
    
    let names = '';
    if (singleId) {
        names = students.find(s => s.id === singleId)?.full_name;
    } else {
        // **PERSISTENT SELECTION LOGIC**
        // Map selectedStudentIds (Set) back to Student objects
        names = Array.from(selectedStudentIds)
            .map(id => {
                const s = students.find(std => std.id === id);
                return s ? `${s.full_name} (${s.class_name})` : '';
            })
            .filter(n => n) // Filter out empty strings if student not found
            .join(', ');
    }
    document.getElementById('selected-students-preview').textContent = names;
    document.getElementById('points-amount').value = '';
    document.getElementById('points-modal').classList.remove('hidden');
};

window.handlePointsSubmit = async (e) => {
    e.preventDefault();
    const amount = parseInt(document.getElementById('points-amount').value);
    if(isNaN(amount) || amount < 1) return alert('จำนวนต้องมากกว่า 0');
    
    const reason = document.getElementById('points-reason').value;
    const { type, isBulk,  id } = currentPointAction;
    
    const timestamp = serverTimestamp();
    const batch = writeBatch(db);
    
    let targetIds = [];
    if (isBulk) {
        // **PERSISTENT SELECTION LOGIC**
        // Use the Set instead of DOM
        targetIds = Array.from(selectedStudentIds);
    } else {
        targetIds = [id];
    }
    
    if (targetIds.length === 0) return alert('ไม่พบนักเรียนที่เลือก');

    let totalDamage = 0;
    let contributorsMap = {}; // 🔥 1. สร้างตัวแปร Map

    targetIds.forEach(studentId => {
        const s = students.find(std => std.id === studentId);
        if (!s) return; // Should not happen if sync is correct

        // Explicit Paths
        const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
        const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
        
        
            let finalAmount = amount;
            let logAction = type === 'add' ? 'ได้รับแต้ม' : 'ถูกหักแต้ม';

            if (type === 'add') {
                finalAmount = calculateBuffedPoints(s, amount);

                totalDamage += finalAmount;
                if (finalAmount > amount) logAction += ` (Boost ${finalAmount - amount})`;
                
                // 🔒 เช็คใบเตือน: ถ้ามีใบเตือน -> เข้า pending_points
                if ((s.warning_cards || 0) > 0) {
                    batch.update(sRef, { pending_points: increment(finalAmount) });
                    logAction += ` (ติดสถานะใบเตือน: อายัด)`;
                } else {
                    batch.update(sRef, { points: increment(finalAmount) });
                }
                contributorsMap[studentId] = finalAmount;
                
            } else {
                // ถ้าลดแต้ม -> ลดจาก points ปกติ (หรือจะลด pending ก็ได้แล้วแต่ครู แต่ปกติลดแต้มหลัก)
                batch.update(sRef, { points: increment(-finalAmount) });
            }
            
            batch.set(hRef, {
                student_id: s.id,
                student_name: s.full_name,
                action: logAction,
                amount: finalAmount,
                reason: reason,
                type: type === 'add' ? 'add_points' : 'remove_points',
                timestamp: timestamp
            });
        
    });
     
     
    await batch.commit();
    if (Object.keys(contributorsMap).length > 0) {
        await autoDamageBoss(contributorsMap);
    }
    hidePointsModal();
    showToast(`บันทึกสำเร็จ (${targetIds.length} คน)`);
    
    if(isBulk) {
        // Clear selection after action
        selectedStudentIds.clear();
        // Re-render to clear checkboxes
        renderStudentList(false); // Don't reset page
        updateBulkUI();
    }
};

window.hidePointsModal = () => {
    document.getElementById('points-modal').classList.add('hidden');
    document.getElementById('points-amount').value = '';
    document.getElementById('points-reason').value = '';
};

// **PERSISTENT SELECTION LOGIC**
// Row Checkbox Handler
window.toggleSelectStudent = (id) => {
    if (selectedStudentIds.has(id)) {
        selectedStudentIds.delete(id);
    } else {
        selectedStudentIds.add(id);
    }
    updateBulkUI();
    renderStudentList(false);
};

window.toggleSelectAll = () => {
    const allCheckbox = document.getElementById('select-all');
    if (!allCheckbox) return;

    const isChecked = allCheckbox.checked;
    
    // 1. กรองข้อมูล (Search Logic)
    const filter = document.getElementById('search-input').value.toLowerCase();
    let filtered = students.filter(s => 
        s.full_name.toLowerCase().includes(filter) || 
        s.student_id.includes(filter) ||
        (s.class_name && s.class_name.toLowerCase().includes(filter))
    );

    // 2. จัดเรียง (Sort Logic)
    if (sortState.student.col) {
        filtered = sortList(filtered, sortState.student.col, sortState.student.asc);
    }

    // =========================================================
    // 🔥 แก้ตรงนี้: คำนวณตัดแบ่งหน้าเอง (Manual Slice)
    // =========================================================
    
    // ดึงเลขหน้าปัจจุบัน (ใช้ key 'student' ตามหน้าจอ)
    const currentPage = window.paginationState.student || 1;
    const perPage = window.itemsPerPage || 10;
    
    // คำนวณจุดตัด Start - End
    const startIndex = (currentPage - 1) * perPage;
    const endIndex = startIndex + perPage;
    
    // ตัดเอาเฉพาะนักเรียนที่โชว์ในหน้านี้
    const visibleStudents = filtered.slice(startIndex, endIndex);

    // =========================================================

    // 3. วนลูปเลือก/ยกเลิกเลือก
    visibleStudents.forEach(s => {
        if (isChecked) {
            selectedStudentIds.add(s.id);
        } else {
            selectedStudentIds.delete(s.id);
        }
    });

    // 4. อัปเดตหน้าจอ
    renderStudentList(false); // false = ไม่ต้องรีเซ็ตหน้ากลับไปหน้า 1
    updateBulkUI();
};

// อัปเดต UI ของ Bulk Action (เงื่อนไข: ต้องเลือก 2 คนขึ้นไปถึงจะโชว์)
window.updateBulkUI = () => {
    const count = selectedStudentIds.size;
    const bulkDiv = document.getElementById('bulk-actions');
    
    // อัปเดตตัวเลข
    document.getElementById('selected-count').textContent = count;
    
    // อัปเดตชื่อตัวอย่าง (Preview Name)
    const previewEl = document.getElementById('selected-names-preview');
    if (count === 1) {
        const id = selectedStudentIds.values().next().value;
        const s = students.find(x => x.id === id);
        previewEl.textContent = s ? s.full_name : '';
    } else if (count > 1) {
        previewEl.textContent = '(เลือกหลายคน)';
    } else {
        previewEl.textContent = '';
    }

    // --- Logic การแสดงผล ---
    if (count >= 1) { // เลือกอย่างน้อย 1 คน ให้โชว์เลย
        bulkDiv.classList.remove('hidden');
        bulkDiv.classList.add('flex');

        // จัดการปุ่มที่ทำได้ "ทีละคน" (Single Actions)
        const singleBtns = document.querySelectorAll('.btn-single');
        
        if (count === 1) {
            // ถ้าเลือก 1 คน -> เปิดใช้งานปุ่ม Single
            singleBtns.forEach(btn => {
                btn.classList.remove('opacity-30', 'cursor-not-allowed', 'grayscale');
                btn.disabled = false;
            });
        } else {
            // ถ้าเลือก > 1 คน -> ปิดใช้งานปุ่ม Single (จางลง)
            singleBtns.forEach(btn => {
                btn.classList.add('opacity-30', 'cursor-not-allowed', 'grayscale');
                btn.disabled = true;
            });
        }

    } else {
        bulkDiv.classList.add('hidden');
        bulkDiv.classList.remove('flex');
    }
};

// ✨ ฟังก์ชันใหม่: ตัวกลางจัดการปุ่ม Single Action บน Sticky Bar
window.handleStickySingleAction = (action) => {
    // ดึง ID ของคนเดียวที่ถูกเลือก
    if (selectedStudentIds.size !== 1) return;
    const id = selectedStudentIds.values().next().value;
    
    if (!id) return;

    // เรียก Modal ตามประเภท
    if (action === 'edit') openEditStudentModal(id);
    else if (action === 'shop') openStudentRedeemModal(id);
    else if (action === 'inventory') openTeacherInventory(id);
};




// ฟังก์ชันยกเลิกการเลือก (ปุ่มใหม่)
// ✅ ฟังก์ชันยกเลิกการเลือก (แก้ไขให้รองรับหน้าจอใหม่)
window.cancelBulkSelection = () => {
    // 1. ล้างรายชื่อที่จำไว้ใน Set
    selectedStudentIds.clear(); 
    
    // 2. เอาติ๊กถูกออกจาก "ปุ่มเลือกทั้งหมด" ด้านบน
    const selectAllCheckbox = document.getElementById('select-all');
    if(selectAllCheckbox) selectAllCheckbox.checked = false;

    // 3. อัปเดตแถบเมนูด้านบน (มันจะซ่อนตัวเองเพราะจำนวนเป็น 0)
    updateBulkUI();

    // ✨ 4. สั่งวาดตารางใหม่ (Re-render) เพื่อให้สีเขียวๆ หายไปทันที
    if (typeof renderStudentList === 'function') {
        renderStudentList(false); // false = ไม่ต้องรีเซ็ตไปหน้า 1 (อยู่ที่หน้าเดิม)
    }
};

// Rewards
window.toggleStockInput = (prefix) => {
    const isUnlimited = document.getElementById(`${prefix}-reward-unlimited`).checked;
    const stockInput = document.getElementById(`${prefix}-reward-stock`);
    stockInput.disabled = isUnlimited;
    if(isUnlimited) stockInput.value = '';
};

// ฟังก์ชันใหม่: สลับสถานะช่องโควตา
window.toggleQuotaInput = (prefix) => {
    const isUnlimited = document.getElementById(`${prefix}-reward-quota-unlimited`).checked;
    const input = document.getElementById(`${prefix}-reward-quota`);
    input.disabled = isUnlimited;
    if(isUnlimited) input.value = '';
};

window.showAddRewardModal = () => {
    // 1. รีเซ็ตฟอร์ม (ช่องกรอกข้อมูลทั้งหมด)
    const form = document.querySelector('#add-reward-modal form');
    if(form) form.reset();

    // 2. ล้างรายการสุ่มที่ค้างอยู่ (Clear List)
    const gachaList = document.getElementById('gacha-slots-list');
    if(gachaList) gachaList.innerHTML = '';

    // ✨ 3. รีเซ็ตตัวเลข % ให้กลับเป็น 0 (แก้บั๊กตรงนี้)
    const totalChanceDisplay = document.getElementById('gacha-total-chance');
    if(totalChanceDisplay) {
        totalChanceDisplay.textContent = '0';
        totalChanceDisplay.className = 'font-bold'; // รีเซ็ตสีตัวอักษรกลับเป็นปกติ
    }

    // 4. รีเซ็ตการแสดงผล Input (ซ่อนส่วน Gacha ไว้ก่อน)
    toggleRewardTypeInputs();

    // 5. เปิดหน้าต่าง
    document.getElementById('add-reward-modal').classList.remove('hidden');
};

// ฟังก์ชันเพิ่มรางวัล/ไอเทม แบบรองรับระบบ Gamification [cite: 624-628]
// Modified Add Reward (แก้ไข Error กดบันทึกไม่ได้)

// Edit Reward
window.openEditRewardModal = (id) => {
    const r = rewards.find(r => r.id === id);
    if(!r) return;
    
    // 1. โหลดข้อมูลพื้นฐาน
    document.getElementById('edit-reward-id').value = id;
    document.getElementById('edit-reward-name').value = r.name;
    document.getElementById('edit-reward-img').value = r.image || '';
    document.getElementById('edit-reward-points').value = r.points;
    document.getElementById('edit-reward-quota').value = r.quota || 0;
    // ✅ เพิ่ม: โหลดค่า Checkbox กลับมาแสดง
    document.getElementById('edit-reward-no-guild').checked = r.no_guild_discount || false;
    document.getElementById('edit-reward-no-personal').checked = r.no_personal_discount || false;
    document.getElementById('edit-reward-active').checked = (r.is_active !== false);
    document.getElementById('edit-reward-category').value = r.category || 'ทั่วไป';
    
    // 2. จัดการสต็อก
    if (r.stock === -1) {
        document.getElementById('edit-reward-unlimited').checked = true;
        document.getElementById('edit-reward-stock').value = '';
        document.getElementById('edit-reward-stock').disabled = true;
    } else {
        document.getElementById('edit-reward-unlimited').checked = false;
        document.getElementById('edit-reward-stock').value = r.stock;
        document.getElementById('edit-reward-stock').disabled = false;
    }

    // --- 🟢 ส่วนที่เพิ่ม: โหลดค่า Quota ---
    if (r.quota === 0) { // 0 คือไม่จำกัด
        document.getElementById('edit-reward-quota-unlimited').checked = true;
        document.getElementById('edit-reward-quota').value = '';
        document.getElementById('edit-reward-quota').disabled = true;
    } else {
        document.getElementById('edit-reward-quota-unlimited').checked = false;
        document.getElementById('edit-reward-quota').value = r.quota;
        document.getElementById('edit-reward-quota').disabled = false;
    }

    // 3. จัดการประเภทและ Gacha Builder
    const typeSelect = document.getElementById('edit-reward-type');
    typeSelect.value = r.type || 'general';
    
    // ล้าง Slot เก่าก่อน
    document.getElementById('edit-gacha-slots-list').innerHTML = '';

    // ถ้าเป็น Gacha ให้โหลด Slot เดิมมาโชว์
    if (r.type === 'gacha_custom' && r.gacha_pool) {
        r.gacha_pool.forEach(slotData => {
            addEditGachaSlot(slotData);
        });
    }

    toggleEditRewardTypeInputs(); // สั่งโชว์/ซ่อน Builder ตามประเภท
    document.getElementById('edit-reward-modal').classList.remove('hidden');
};

window.handleEditRewardSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-reward-id').value;
    const type = document.getElementById('edit-reward-type').value;

    // จัดการสต็อก
    const isUnlimited = document.getElementById('edit-reward-unlimited').checked;
    const stock = isUnlimited ? -1 : parseInt(document.getElementById('edit-reward-stock').value);

    
        const isQuotaUnlimited = document.getElementById('edit-reward-quota-unlimited').checked;
        const quota = isQuotaUnlimited ? 0 : (parseInt(document.getElementById('edit-reward-quota').value) || 0);
    

    const updates = {
        is_active: document.getElementById('edit-reward-active').checked,
        name: document.getElementById('edit-reward-name').value,
        points: parseInt(document.getElementById('edit-reward-points').value),
        stock: stock,
        image: document.getElementById('edit-reward-img').value || '',
        quota: quota,
        type: type,
        effect: 'none',
        no_guild_discount: document.getElementById('edit-reward-no-guild').checked,
        no_personal_discount: document.getElementById('edit-reward-no-personal').checked,
        category: document.getElementById('edit-reward-category').value
    };

    if (type === 'gacha_custom') {
        let gachaPool = [];
        let isValid = true; // ตัวเช็คความถูกต้อง

        document.querySelectorAll('.edit-gacha-slot-item').forEach(slot => {
            if (!isValid) return;

            const slotType = slot.querySelector('.slot-type').value;
            const chance = parseFloat(slot.querySelector('.slot-chance').value) || 0;
            
            let data = { type: slotType, chance: chance };
            
            if (slotType === 'points') {
                data.min = parseInt(slot.querySelector('.slot-min').value) || 0;
                data.max = parseInt(slot.querySelector('.slot-max').value) || 0;

                // --- 🛡️ Validation ---
                if (data.min < 0 || data.max < 0) { alert('คะแนนห้ามติดลบ'); isValid = false; return; }
                if (data.min >= data.max) { alert(`ค่า Min (${data.min}) ต้องน้อยกว่า Max (${data.max})`); isValid = false; return; }
                // ---------------------

            } 
            else if (slotType === 'points_fix') {
            // 1. ดึงค่าแต้มที่ระบุ
            data.amount = parseInt(slot.querySelector('.slot-fix-amount').value) || 0;
            
            // 2. ดึง URL รูปภาพ (ถ้ามี)
            const imgInput = slot.querySelector('.slot-fix-image');
            data.image = imgInput ? imgInput.value.trim() : '';

            // 3. ตรวจสอบความถูกต้อง
            if (data.amount <= 0) { 
                alert('จำนวนแต้มต้องมากกว่า 0'); 
                isValid = false; 
                return; 
            }
        }
             else if (slotType === 'interest') {  
                data.rate = parseFloat(slot.querySelector('.slot-rate').value) || 1.0;
                data.hours = parseFloat(slot.querySelector('.slot-hours').value) || 24;

                // --- 🛡️ Validation ---
                if (data.rate <= 0) { alert('ดอกเบี้ยต้อง > 0'); isValid = false; return; }
                if (data.hours <= 0) { alert('ระยะเวลาต้อง > 0'); isValid = false; return; }
                // ---------------------
            }
            else if (slotType === 'buff_discount') {
                data.value = parseInt(slot.querySelector('.input-buff_discount .slot-value').value) || 0;
                data.duration = parseInt(slot.querySelector('.input-buff_discount .slot-duration').value) || 60;
                if (data.value <= 0) { alert('ส่วนลดต้องมากกว่า 0%'); isValid = false; return; }
            }
            else if (slotType === 'buff_points') {
                data.value = parseInt(slot.querySelector('.input-buff_points .slot-value').value) || 0;
                data.duration = parseInt(slot.querySelector('.input-buff_points .slot-duration').value) || 24;
                if (data.value <= 0) { alert('ค่าบูสต์แต้มต้องมากกว่า 0%'); isValid = false; return; }
            }
            else if (slotType === 'reward_ref') {
                data.reward_id = slot.querySelector('.slot-reward-id').value;
            } else if (slotType === 'text') {
                data.text = slot.querySelector('.slot-text').value;
            }
            gachaPool.push(data);
        });

        if (!isValid) return; // หยุดถ้าไม่ผ่าน

        const totalChance = gachaPool.reduce((sum, item) => sum + item.chance, 0);
        if (totalChance !== 100) {
             if(!confirm(`อัตราการออกรวมคือ ${totalChance}% (ไม่ครบ 100%)\nต้องการบันทึกหรือไม่?`)) return;
        }

        updates.gacha_pool = gachaPool;
    }

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rewards', id), updates);
    document.getElementById('edit-reward-modal').classList.add('hidden');
    showToast('แก้ไขของรางวัลเรียบร้อย');
};

// ฟังก์ชันรีเซ็ตโควตาเฉพาะของรางวัลชิ้นนั้น (รวมถึงกล่องสุ่ม)
window.resetSingleRewardQuota = async () => {
    const rewardId = document.getElementById('edit-reward-id').value;
    const rewardName = document.getElementById('edit-reward-name').value;

    if (!rewardId) return;

    if (!confirm(`ยืนยันการรีเซ็ตโควตาสำหรับ "${rewardName}"?\n\n- นักเรียนทุกคนที่เคยแลกไป จะสามารถกลับมาแลกได้ใหม่\n- สต็อกของรางวัลจะ "เท่าเดิม" (ไม่คืนสต็อก)\n\nต้องการดำเนินการหรือไม่?`)) return;

    showToast('กำลังดำเนินการรีเซ็ตโควตา... ⏳');

    // ใช้ Batch เพื่อประสิทธิภาพและรองรับจำนวนนักเรียนเยอะ
    const batchArray = [];
    let currentBatch = writeBatch(db);
    let operationCount = 0;
    let updatedCount = 0;

    students.forEach(s => {
        // เช็คว่านักเรียนคนนี้เคยแลกของชิ้นนี้ไหม (ถ้าเคย ถึงจะสั่งลบ)
        if (s.redeemed_history && s.redeemed_history[rewardId]) {
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
            
            // ใช้ deleteField() เพื่อลบ key ของรางวัลนั้นออกจาก history
            currentBatch.update(sRef, {
                [`redeemed_history.${rewardId}`]: deleteField()
            });

            updatedCount++;
            operationCount++;

            // Firestore จำกัด Batch ละ 500 รายการ
            if (operationCount >= 450) {
                batchArray.push(currentBatch.commit());
                currentBatch = writeBatch(db);
                operationCount = 0;
            }
        }
    });

    // เก็บตก Batch สุดท้าย
    if (operationCount > 0) {
        batchArray.push(currentBatch.commit());
    }

    try {
        await Promise.all(batchArray);
        if (updatedCount > 0) {
            showToast(`✅ รีเซ็ตโควตาให้นักเรียน ${updatedCount} คนเรียบร้อย`);
        } else {
            showToast('ข้อมูลเป็นปัจจุบันอยู่แล้ว (ยังไม่มีใครแลกของชิ้นนี้)');
        }
    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};


window.confirmDeleteReward = (id) => {
    showConfirmModal('ลบของรางวัล', 'ยืนยันลบของรางวัลนี้?', async () => {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rewards', id));
        showToast('ลบของรางวัลเรียบร้อย');
    });
};

// Delete Reward Helper
window.deleteReward = (id) => {
   // Deprecated direct call, use confirmDeleteReward instead
   confirmDeleteReward(id); 
};

window.openStudentRedeemModal = (studentId) => {
    selectedStudentForRedeem = students.find(s => s.id === studentId);
    if(!selectedStudentForRedeem) return;
    
    document.getElementById('shop-student-name').textContent = `สำหรับ: ${selectedStudentForRedeem.full_name} (แต้ม: ${Math.floor(selectedStudentForRedeem.points).toLocaleString()})`;
    renderShopGrid();
    document.getElementById('student-redeem-modal').classList.remove('hidden');
};

// ค้นหาฟังก์ชัน renderShopGrid ในไฟล์ app.js แล้ววางทับด้วยโค้ดนี้ครับ
function renderShopGrid() {
    const grid = document.getElementById('shop-grid');
    const generalItems = rewards.filter(r => r.shop_type !== 'guild');
    
    if (typeof selectedStudentForRedeem === 'undefined' || !selectedStudentForRedeem) {
        grid.innerHTML = '<p class="text-center text-gray-500 w-full col-span-3">ไม่พบข้อมูลนักเรียน</p>';
        return;
    }

    // ดึงข้อมูลสดใหม่เสมอ
    const s = students.find(x => x.id === selectedStudentForRedeem.id);
    if (!s) { 
         grid.innerHTML = '<p class="text-center text-gray-500 w-full col-span-3">ข้อมูลนักเรียนไม่อัปเดต โปรดลองใหม่</p>';
         return;
    }
    const currentInv = (s.inventory || []).length;
    const isBagFull = currentInv >= 5; // (เลข 5 คือโควตา)

    let items = generalItems.map(r => {
        // เช็คว่าเป็นกาชาหรือไม่ (เพื่อใส่ icon หรือลูกเล่นเฉยๆ)
        const isGacha = r.type === 'random_box' || r.type === 'gacha_custom' || (r.gacha_data && r.gacha_data.length > 0);

        // --- ส่วนลด ---
        let guildDiscount = 0;
        let pDiscount = 0;

        if (!r.no_guild_discount && s.guild_id) {
            const activeBuffs = getGuildActiveBuffs(s.guild_id);
            if (activeBuffs && activeBuffs.discount) guildDiscount = parseInt(activeBuffs.discount) || 0;
        }
        
        if (!r.no_personal_discount && s.buff_discount_end) {
            let endTime = s.buff_discount_end;
            if (typeof endTime.toMillis === 'function') endTime = endTime.toMillis();
            else if (endTime instanceof Date) endTime = endTime.getTime();
            
            if (Date.now() < endTime) {
                pDiscount = parseInt(s.buff_discount_val || 0);
            }
        }
        
        const totalDiscount = Math.min(100, guildDiscount + pDiscount);
        let finalPoints = r.points;
        if (r.points > 0 && totalDiscount > 0) {
            finalPoints = Math.ceil(r.points * (100 - totalDiscount) / 100);
        }

        // --- เช็คโควตา (ใช้กับทุกสินค้า รวมถึงกาชา) ---
        let isQuotaFull = false;
        let remainingQuota = -1;

        if (r.quota > 0) {
            const currentRedeemed = (s.redeemed_history && s.redeemed_history[r.id]) || 0;
            remainingQuota = r.quota - currentRedeemed;
            
            if (remainingQuota <= 0) {
                isQuotaFull = true;
                remainingQuota = 0;
            }
        }

        const isGain = r.points < 0;
        const canAfford = s.points >= finalPoints;
        const isUnlimited = (r.stock === -1 || r.stock === '-1');
        const hasStock = isUnlimited || parseInt(r.stock) > 0;
        
        
        const available = (canAfford || isGain) && hasStock && !isQuotaFull && !isBagFull;

        return {
            ...r,
            finalPoints,
            totalDiscount,
            isGain,
            canAfford,
            hasStock,
            isUnlimited,
            isQuotaFull,
            remainingQuota,
            available,
            isGacha 
        };
    });
    
    items = items.filter(r => r.is_active !== false);

    items.sort((a, b) => {
        if (a.available && !b.available) return -1;
        if (!a.available && b.available) return 1;
        return a.finalPoints - b.finalPoints;
    });

    grid.innerHTML = items.map(r => {
        const disabled = !r.available;
        
        let pointsDisplay = '';
        let discountBadge = '';

        if (r.isGain) {
            pointsDisplay = `<span class="text-green-600 font-bold text-sm">+${Math.abs(r.points).toLocaleString()} แต้ม</span>`;
        } else {
            if (r.totalDiscount > 0) {
                discountBadge = `<span class="ml-2 bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-bold">-${r.totalDiscount}%</span>`;
                pointsDisplay = `
                    <span class="text-gray-400 line-through text-xs mr-1">${(r.points).toLocaleString()}</span>
                    <span class="text-red-600 font-bold text-sm">${(r.finalPoints).toLocaleString()} แต้ม</span>
                    ${discountBadge}
                `;
            } else {
                pointsDisplay = `<span class="text-amber-600 font-bold text-sm">${(r.points).toLocaleString()} แต้ม</span>`;
            }
        }

        // --- ✅ แก้ไข: ปรับปุ่มให้เหมือนกันหมด ---
        let btnText = r.isGain ? '🎁 รับเลย' : '💰 แลกเลย';
        // ใช้สีม่วงสำหรับกาชาเพื่อให้ดูเด่นขึ้นนิดหน่อย แต่ข้อความใช้ "แลกเลย" เหมือนกัน
        let btnClass = r.isGain ? 'bg-indigo-600 hover:bg-indigo-700' : (r.isGacha ? 'bg-purple-600 hover:bg-purple-700' : 'bg-green-500 hover:bg-green-600');

        if (disabled) {
            btnClass = 'bg-gray-300 cursor-not-allowed';
            if (r.isQuotaFull) {
                btnText = '❌ ครบโควตา';
            } else if (!r.hasStock) {
                btnText = '❌ สินค้าหมด';
            }
            else if (isBagFull) {          // <--- เพิ่มบรรทัดนี้
                btnText = '🎒 กระเป๋าเต็ม';   // <--- ปุ่มจะขึ้นว่ากระเป๋าเต็ม
            }
            else if (!r.canAfford && !r.isGain) {
                btnText = '🔒 แต้มไม่พอ';
            }
        }

        // --- แสดงป้ายโควตา ---
        let quotaLabel = '';
        if (r.quota > 0) {
            if (r.isQuotaFull) {
                quotaLabel = `<div class="text-[10px] text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-full border border-red-100">สิทธิ์หมดแล้ว (${r.quota}/${r.quota})</div>`;
            } else {
                quotaLabel = `<div class="text-[10px] text-blue-500 font-bold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">เหลือ ${r.remainingQuota} สิทธิ์</div>`;
            }
        } else {
             quotaLabel = `<div class="text-[10px] text-gray-400">ไม่จำกัดโควตา</div>`;
        }

        // ✅ แก้ไข Action: บังคับให้ทุกคนเข้าหน้าเลือกจำนวน (selectRewardForRedeem)
        let clickAction = `selectRewardForRedeem('${r.id}')`;

        return `
        <div class="border rounded-xl p-3 flex flex-col justify-between bg-white shadow-sm transition-all ${disabled ? 'opacity-70 bg-gray-50' : 'hover:shadow-md hover:border-amber-300'}">
            <div class="h-24 bg-gray-50 rounded-lg flex items-center justify-center mb-2 overflow-hidden border border-gray-100 relative">
                 ${r.image ? `<img src="${r.image}" class="w-full h-full object-cover ${disabled ? 'grayscale' : ''}">` : `<span class="text-2xl">${r.isGacha ? '🎲' : '🎁'}</span>`}
                 ${!r.hasStock ? '<div class="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-bold text-xs">หมด</div>' : ''}
            </div>
            <div>
                <h4 class="font-bold text-gray-800 text-sm line-clamp-1" title="${r.name}">${r.name}</h4>
                <div class="mt-1 mb-1">
                    ${pointsDisplay}
                </div>
                
                <div class="flex justify-between items-center mt-2 mb-2">
                    <div class="text-[10px] text-gray-500 flex items-center gap-1">
                        📦 ${r.isUnlimited ? '∞' : r.stock}
                    </div>
                    ${quotaLabel}
                </div>
            </div>
            
            <button onclick="${clickAction}" ${disabled ? 'disabled' : ''} 
                class="mt-auto w-full py-2 rounded-lg text-xs font-bold text-white transition-colors shadow-sm ${btnClass}">
                ${btnText}
            </button>
        </div>`;
    }).join('');
}

let currentDiscountPercent = 0;
window.selectRewardForRedeem = (rewardId) => {

    // =======================================================
    // 🎒 ส่วนที่ 1: เช็คกระเป๋า (แทรกตรงนี้)
    // =======================================================
    const s = students.find(x => x.id === selectedStudentForRedeem.id);
    const MAX_SLOTS = 3; // กำหนดจำนวนช่องเก็บของ

    // ถ้าไม่ใช่ครูแจกฟรี (ซื้อเอง) และกระเป๋าเต็ม
    const currentInventory = s.inventory || [];
    if (currentInventory.length >= MAX_SLOTS) {
        Swal.fire({
            icon: 'warning',
            title: 'กระเป๋าเต็มแล้ว! 🎒',
            html: `นักเรียนคนนี้มีไอเทมครบ ${MAX_SLOTS} ชิ้นแล้ว<br>ต้องใช้ของเก่าก่อนถึงจะแลกใหม่ได้ครับ`,
            confirmButtonText: 'ตกลง'
        });
        return; // 🛑 หยุดทันที ไม่เปิดหน้าต่างแลก
    }
    redeemTarget = rewards.find(r => r.id === rewardId);
    // ปิดหน้าเลือกของ
    document.getElementById('student-redeem-modal').classList.add('hidden');
    
    // --- 1. คำนวณส่วนลด (รวมพลังกิลด์ + ส่วนตัว) ---
    // --- 1. คำนวณส่วนลด (แก้ไขใหม่: เช็ค flag ห้ามลด) ---
    let totalDiscount = 0;
    if (typeof selectedStudentForRedeem !== 'undefined' && selectedStudentForRedeem) {
        
        // A. ส่วนลดกิลด์ (เช็ค: !redeemTarget.no_guild_discount)
        let gDiscount = 0;
        if (!redeemTarget.no_guild_discount && selectedStudentForRedeem.guild_id) {
            const activeBuffs = getGuildActiveBuffs(selectedStudentForRedeem.guild_id);
            if (activeBuffs && activeBuffs.discount) gDiscount = parseInt(activeBuffs.discount);
        }
        
        // B. ส่วนลดส่วนตัว (เช็ค: !redeemTarget.no_personal_discount)
        let pDiscount = 0;
        if (!redeemTarget.no_personal_discount && selectedStudentForRedeem.buff_discount_end) {
            let endTime = selectedStudentForRedeem.buff_discount_end;
            if (typeof endTime.toMillis === 'function') endTime = endTime.toMillis();
            else if (endTime instanceof Date) endTime = endTime.getTime();
            
            if (Date.now() < endTime) {
                pDiscount = parseInt(selectedStudentForRedeem.buff_discount_val || 0);
            }
        }
        
        totalDiscount = Math.min(100, gDiscount + pDiscount);
    }
    
    // --- 2. ตั้งราคาขายจริง (Actual Price) ---
    let unitPrice = redeemTarget.points;
    // ลดราคาเฉพาะของที่ต้องจ่ายแต้ม (points > 0)
    if (unitPrice > 0 && totalDiscount > 0) {
        unitPrice = Math.ceil(unitPrice * (100 - totalDiscount) / 100);
    }
    redeemTarget.actualPrice = unitPrice; // บันทึกราคาจริงไว้ใช้งาน

    // --- 3. คำนวณเพดานการแลก (Max Quantity) ---
    // เพดานจากแต้มที่มี
    let maxByPoints = Infinity;
    if (redeemTarget.actualPrice > 0) {
         maxByPoints = Math.floor(selectedStudentForRedeem.points / redeemTarget.actualPrice);
    }
    
    // เพดานจากสต็อก
    const maxByStock = (redeemTarget.stock === -1) ? Infinity : redeemTarget.stock;
    
    // เพดานจากโควตา
    let maxByQuota = Infinity;
    if (redeemTarget.quota > 0) {
        const currentRedeemed = (selectedStudentForRedeem.redeemed_history && selectedStudentForRedeem.redeemed_history[redeemTarget.id]) || 0;
        maxByQuota = Math.max(0, redeemTarget.quota - currentRedeemed);
    }

    // หาค่าต่ำสุดที่เป็นไปได้
    currentMaxRedeemQty = Math.min(maxByPoints, maxByStock, maxByQuota);
    if (currentMaxRedeemQty < 0) currentMaxRedeemQty = 0;

    // --- 4. อัปเดต UI หน้าจอ ---
    document.getElementById('redeem-qty').value = 0;
    
    // ตั้งชื่อหัวข้อ (Title) [จุดที่คุณหาไม่เจอคือตรงนี้ครับ]
    const isGain = redeemTarget.points < 0;
    const actionText = isGain ? 'ส่งงาน / รับ' : 'แลก';
    document.getElementById('redeem-modal-title').textContent = `${actionText} ${redeemTarget.name}`;
    
    // สร้างป้ายราคา (Subtitle)
    const maxText = (currentMaxRedeemQty === Infinity) ? 'ไม่จำกัด' : `${currentMaxRedeemQty} ชิ้น`;
    
    let priceHtml = '';
    if (isGain) {
        priceHtml = `<span class="text-green-600 font-bold">ได้รับ +${Math.abs(redeemTarget.points)} แต้ม/ชิ้น</span>`;
    } else {
        priceHtml = `ราคา ${(redeemTarget.actualPrice).toLocaleString()} แต้ม/ชิ้น`;
        if (totalDiscount > 0) {
            priceHtml += ` <span class="text-red-500 font-bold">(-${totalDiscount}%)</span>`;
        }
    }

    document.getElementById('redeem-modal-subtitle').innerHTML = `${priceHtml} <span class="text-gray-400 text-xs ml-2">(สูงสุด: ${maxText})</span>`;
    
    calculateRedeemTotal();
    
    // เปิด Modal
    document.getElementById('redeem-quantity-modal').classList.remove('hidden');
    document.getElementById('redeem-quantity-modal').classList.add('flex');
};

let redeemTarget = { id: null, name: '', points: 0, quota: 0 };
let selectedStudentForRedeem = null;
let currentMaxRedeemQty = 1; // ตัวแปรเก็บค่าเพดานสูงสุดสำหรับการแลกครั้งนั้นๆ

window.hideRedeemQuantityModal = () => {
    document.getElementById('redeem-quantity-modal').classList.add('hidden');
    document.getElementById('redeem-quantity-modal').classList.remove('flex');
};

window.validateRedeemInput = (el) => {
    let val = parseInt(el.value);
    if (isNaN(val) || val < 0) {
         val = 0;
    }
    // ถ้าพิมพ์เกินเพดาน ให้ดีดกลับมาที่ค่าสูงสุด
    if (val > currentMaxRedeemQty) {
        val = currentMaxRedeemQty;
        // แจ้งเตือนเล็กน้อย (Optional)
        // showToast(`แลกได้สูงสุดเพียง ${currentMaxRedeemQty} ชิ้นครับ`); 
    }
    
    el.value = val;
    calculateRedeemTotal();
};

window.adjustRedeemQty = (delta) => {
    const input = document.getElementById('redeem-qty');
    let val = parseInt(input.value) + delta;
    
    // ห้ามต่ำกว่า 0
    if(val < 0) val = 0;
    
    // ห้ามเกินเพดาน (Ceiling Check)
    if(val > currentMaxRedeemQty) val = currentMaxRedeemQty;

    input.value = val;
    calculateRedeemTotal();
};

window.calculateRedeemTotal = () => {
    const qty = parseInt(document.getElementById('redeem-qty').value) || 0;
    const total = qty * redeemTarget.actualPrice;
    const totalEl = document.getElementById('redeem-total-points');
    
    // --- 🟢 ส่วนที่แก้: แสดงผลรวมแบบฉลาด ---
    const isGain = redeemTarget.points < 0;
    
    if (isGain) {
        // กรณีได้รับแต้ม (ส่งงาน)
        totalEl.textContent = `+${Math.abs(total).toLocaleString()}`;
        totalEl.classList.remove('text-amber-600', 'text-red-600');
        totalEl.classList.add('text-green-600');
    } else {
        // กรณีแลกของ (เสียแต้ม)
        totalEl.textContent = total.toLocaleString();
        
        if (qty > currentMaxRedeemQty) {
             totalEl.classList.remove('text-amber-600');
             totalEl.classList.add('text-red-600');
        } else {
             totalEl.classList.add('text-amber-600');
             totalEl.classList.remove('text-red-600');
        }
    }
    // -------------------------------------
};


// 5. Bank Logic
// ฟังก์ชันคำนวณดอกเบี้ย (แก้ไข: รองรับบัฟส่วนตัวแบบ Override)
// ฟังก์ชันคำนวณดอกเบี้ย (ฉบับอัปเกรด: ทบทุกบัฟ! 🚀)
// 📂 app.js (แก้ไขฟังก์ชัน calculatePendingInterest ให้คำนวณแยกช่วงเวลา)

function calculatePendingInterest(student) {
    // 1. 🔒 เช็คใบเตือน: ถ้ามีใบเตือน ดอกเบี้ยเป็น 0 เสมอ
    if ((student.warning_cards || 0) > 0) return 0;

    if (!student.bank_points || !student.bank_deposit_time) return 0;

    // แปลงเวลาฝากเป็น Milliseconds
    let depositTime = student.bank_deposit_time;
    if (depositTime && typeof depositTime.toMillis === 'function') depositTime = depositTime.toMillis();
    else if (depositTime instanceof Date) depositTime = depositTime.getTime();
    else if (depositTime.seconds) depositTime = depositTime.seconds * 1000;
    else return 0;

    const now = Date.now();
    
    // ถ้าเวลาเพี้ยน (ฝากในอนาคต) ให้เป็น 0
    if (now < depositTime) return 0;

    // --- กำหนดตัวแปร Rate ---
    let normalRate = config.interest_rate || 1.0; // เรทปกติ
    let guildBuffRate = 0; // บัฟกิลด์

    // ดึงบัฟกิลด์ (ถ้ามี)
    if (student.guild_id && typeof getGuildActiveBuffs === 'function') {
        const activeBuffs = getGuildActiveBuffs(student.guild_id);
        if (activeBuffs && activeBuffs.interest) {
            guildBuffRate = parseFloat(activeBuffs.interest);
        }
    }
    
    // เรทพื้นฐานรวม (ปกติ + กิลด์)
    const baseRate = normalRate + guildBuffRate;

    // --- ตรวจสอบบัฟส่วนตัว (ดอกเบี้ยเทพ) ---
    let specialEndTime = null;
    let specialRateVal = 0;

    if (student.special_interest_end) {
        let t = student.special_interest_end;
        if (typeof t.toMillis === 'function') t = t.toMillis();
        else if (t instanceof Date) t = t.getTime();
        else if (t.seconds) t = t.seconds * 1000;
        
        specialEndTime = t;
        specialRateVal = parseFloat(student.special_interest_rate || 0);
    }

    // ======================================================
    // 🧮 การคำนวณแบบแยกช่วงเวลา (Split Calculation)
    // ======================================================
    
    let totalInterest = 0;

    if (specialEndTime && specialRateVal > 0) {
        // กรณีมีบัฟเทพ (หรือเคยมี)
        const highRate = baseRate + specialRateVal; // เรทเทพ

        if (now <= specialEndTime) {
            // ✅ กรณี A: บัฟยังไม่หมดอายุ (คำนวณเรทเทพเต็มจำนวน)
            const hours = (now - depositTime) / (1000 * 60 * 60);
            totalInterest = student.bank_points * (highRate / 100) * hours;
        } else {
            // ✅ กรณี B: บัฟหมดอายุไปแล้ว (ต้องคิดแยก 2 ขยัก)
            
            // ขยักที่ 1: ช่วงที่มีบัฟ (จากเวลาฝาก -> เวลาบัฟหมด)
            // (ต้องเช็คด้วยว่าฝากก่อนบัฟหมดจริงไหม)
            if (depositTime < specialEndTime) {
                const hoursHigh = (specialEndTime - depositTime) / (1000 * 60 * 60);
                const interestHigh = student.bank_points * (highRate / 100) * hoursHigh;
                totalInterest += interestHigh;

                // ขยักที่ 2: ช่วงหลังบัฟหมด (จากเวลาบัฟหมด -> ปัจจุบัน) ใช้เรทปกติ
                const hoursNormal = (now - specialEndTime) / (1000 * 60 * 60);
                const interestNormal = student.bank_points * (baseRate / 100) * hoursNormal;
                totalInterest += interestNormal;
            } else {
                // ถ้าฝากหลังบัฟหมดไปแล้ว (เคสแปลกๆ) ก็คิดเรทปกติไปเลย
                const hours = (now - depositTime) / (1000 * 60 * 60);
                totalInterest = student.bank_points * (baseRate / 100) * hours;
            }
        }
    } else {
        // ✅ กรณี C: ไม่มีบัฟเทพเลย (คิดเรทปกติยาวๆ)
        const hours = (now - depositTime) / (1000 * 60 * 60);
        totalInterest = student.bank_points * (baseRate / 100) * hours;
    }

    // ส่งคืนค่าจำนวนเต็ม (ตัดทศนิยมทิ้ง) ตามที่คุณออฟต้องการ
    return Math.floor(totalInterest);
}

let currentBankTarget = null;

// ==========================================
// 🏦 OPEN BANK MODAL (ฉบับสมบูรณ์)
// ==========================================
window.openBankModal = (studentId) => {
    // 1. หา ID เป้าหมาย (ถ้าระบุมาใช้ตัวนั้น ถ้าไม่ระบุใช้ของตัวเอง)
    const checkId = studentId || (currentStudentData ? currentStudentData.id : null);
        if (checkId) {
    const s = students.find(x => x.id === checkId);
        if (s && (s.warning_cards || 0) > 0) {
            document.getElementById('locked-student-name').textContent = s.full_name;
        document.getElementById('locked-warning-count').textContent = s.warning_cards;
        
        const modal = document.getElementById('bank-locked-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        
        return; // จบการทำงาน ไม่เปิดธนาคาร

    }
}

    let targetId = studentId;
    if (!targetId) {
        if (currentStudentData && currentStudentData.id) {
            targetId = currentStudentData.id;
        } else {
            console.error("ไม่พบข้อมูลนักเรียน (No ID provided and no current session)");
            return;
        }
    }

    // 2. ค้นหาข้อมูลจาก ID
    const s = students.find(x => x.id === targetId);
    if (!s) {
        console.error("ไม่พบนักเรียน ID:", targetId);
        return;
    }

    // ✨ 3. เติมข้อมูลลง HTML (ตอนนี้มี Element ครบแล้ว ไม่ Error แน่นอน)
    const idInput = document.getElementById('bank-student-id');
    if(idInput) idInput.value = s.id;

    const nameDisplay = document.getElementById('bank-student-name');
    if(nameDisplay) nameDisplay.textContent = s.full_name;

    const walletDisplay = document.getElementById('bank-wallet-display');
    if(walletDisplay) walletDisplay.textContent = Math.floor(s.points).toLocaleString();
    
    // คำนวณยอดเงิน
    const currentBank = Math.floor(s.bank_points || 0);
    const pendingInterest = Math.floor(calculatePendingInterest(s));
    const totalShow = currentBank + pendingInterest; // ยอดรวมดอกเบี้ย
    
    const balanceDisplay = document.getElementById('bank-balance-display');
    if(balanceDisplay) balanceDisplay.textContent = totalShow.toLocaleString();

    // รีเซ็ตช่องกรอก
    document.getElementById('bank-amount').value = '';
    const noteInput = document.getElementById('bank-note');
    if(noteInput) noteInput.value = '';

    // 4. เปิด Modal
    document.getElementById('bank-action-modal').classList.remove('hidden');
};

// ฟังก์ชันปิด Modal (เปลี่ยนชื่อให้สั้นลงเพื่อให้ตรงกับ HTML)
window.hideBankModal = () => {
    document.getElementById('bank-action-modal').classList.add('hidden');
};

window.closeBankModal = () => {
    document.getElementById('bank-action-modal').classList.add('hidden');
    document.getElementById('bank-action-modal').classList.remove('flex');
};

window.confirmBankAction = async (action) => {
    if(!currentBankTarget) return;
    const s = currentBankTarget;
    
    // คำนวณยอดเงินปัจจุบัน
    const interest = Math.floor(calculatePendingInterest(s)); 
    const currentPrincipal = math.floor(s.bank_points || 0);
    const totalBalance = currentPrincipal + interest; 
    
    let amount = 0;
    let realAction = action; // ตัวแปรเก็บประเภทจริงๆ (เพราะ deposit_all จะถูกแปลงเป็น deposit)

    // --- 🟢 เช็คเงื่อนไขแต่ละปุ่ม ---
    if (action === 'withdraw_all') {
        amount = totalBalance;
        if (amount <= 0) return alert('ไม่มีแต้มในธนาคารให้ถอนครับ');
    } 
    else if (action === 'deposit_all') {
        amount = Math.floor(s.points); // ฝากเท่าที่มีในกระเป๋า
        if (amount <= 0) return alert('ไม่มีแต้มในกระเป๋าให้ฝากครับ');
        realAction = 'deposit'; // เปลี่ยน action เป็นฝากปกติ เพื่อให้ logic ด้านล่างทำงานต่อ
    } 
    else {
        // กรณีระบุตัวเลขเอง
        amount = parseInt(document.getElementById('bank-amount').value);
        if(isNaN(amount) || amount <= 0) return alert('กรุณาระบุจำนวนที่ถูกต้อง');
    }

    const batch = writeBatch(db);
    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
    const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

    // --- เริ่มทำรายการ ---
    if (realAction === 'deposit') {
        if (s.points < amount) return alert('แต้มในกระเป๋าไม่พอฝาก');
        
        // สูตร: เงินต้นใหม่ = ต้นเดิม + ดอกเบี้ยค้างรับ + ยอดฝากใหม่
        const newPrincipal = currentPrincipal + interest + amount;
        
        batch.update(sRef, {
            points: increment(-amount),
            bank_points: newPrincipal,
            bank_deposit_time: serverTimestamp() // รีเซ็ตเวลาเริ่มนับดอกเบี้ยใหม่
        });
        
        batch.set(hRef, {
            student_id: s.id,
            student_name: s.full_name,
            action: action === 'deposit_all' ? 'ฝากหมดหน้าตัก' : 'ฝากธนาคาร',
            amount: amount,
            reason: `รวมดอกเบี้ยทบต้น ${interest} แต้ม`,
            type: 'bank_deposit',
            timestamp: serverTimestamp()
        });

    } else if (realAction === 'withdraw' || realAction === 'withdraw_all') {
        if (amount > totalBalance) return alert(`ยอดเงินไม่พอถอน (มีรวมดอกเบี้ย ${totalBalance})`);
        
        let newPrincipal = totalBalance - amount;
        if (newPrincipal < 0) newPrincipal = 0;

        batch.update(sRef, {
            points: increment(amount),
            bank_points: newPrincipal,
            bank_deposit_time: serverTimestamp()
        });

        batch.set(hRef, {
            student_id: s.id,
            student_name: s.full_name,
            action: action === 'withdraw_all' ? 'ถอนหมดบัญชี' : 'ถอนธนาคาร',
            amount: amount,
            reason: `รวมดอกเบี้ยทบต้น ${interest} แต้ม (เหลือในบัญชี ${newPrincipal})`,
            type: 'bank_withdraw',
            timestamp: serverTimestamp()
        });
    }
    
    await batch.commit();
    closeBankModal();
    showToast('ทำรายการธนาคารสำเร็จ ✅');
};


// Delete History Item (Robust Fix)
window.deleteHistoryItem = async (id) => {
    if(!id) return alert('ไม่พบ ID ประวัติ');
    if (!auth.currentUser) return alert('Session หลุด! กรุณารีเฟรชหน้าจอ');
    
    // ดึงข้อมูลประวัติมาก่อน เพื่อเช็คว่าเป็นประเภทไหน
    try {
        const historyRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', id);
        const historySnap = await getDoc(historyRef);
        
        if (!historySnap.exists()) return alert('ไม่พบรายการนี้แล้ว');
        
        const hData = historySnap.data();
        
        // กรณีเป็นรายการ "แลกของรางวัล" (Redeem)
        if (hData.type === 'redeem' && hData.meta) {
            showConfirmModal('ยกเลิกการแลกรางวัล', 
                `ต้องการ "คืนแต้ม ${hData.amount}" และ "คืนสต็อก" ให้นักเรียนหรือไม่?`, 
                async () => {
                    const batch = writeBatch(db);
                    
                    // 1. คืนแต้มให้นักเรียน และลดโควตาที่ใช้ไป
                    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', hData.student_id);
                    const redeemedKey = `redeemed_history.${hData.meta.reward_id}`;
                    
                    // เช็คว่านักเรียนยังอยู่ไหม
                    const sSnap = await getDoc(sRef);
                    if (sSnap.exists()) {
                         batch.update(sRef, {
                            points: increment(hData.amount),
                            [redeemedKey]: increment(-hData.meta.qty)
                        });
                    }

                    // 2. คืนสต็อกของรางวัล (ถ้าไม่ใช่ Unlimited)
                    if (!hData.meta.is_unlimited) {
                        const rRef = doc(db, 'artifacts', appId, 'public', 'data', 'rewards', hData.meta.reward_id);
                        // เช็คว่าของรางวัลยังอยู่ไหม (เผื่อครูลบของรางวัลทิ้งไปแล้ว)
                        const rSnap = await getDoc(rRef);
                        if (rSnap.exists()) {
                            batch.update(rRef, { stock: increment(hData.meta.qty) });
                        }
                    }

                    // 3. ลบประวัติ
                    batch.delete(historyRef);
                    
                    // เพิ่ม Log การคืนของ (Optional: ถ้าอยากเก็บประวัติการคืน)
                    
                    const refundLogRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
                    batch.set(refundLogRef, {
                        student_id: hData.student_id,
                        student_name: hData.student_name,
                        action: `ยกเลิกแลกรางวัล: ได้รับแต้มคืน ${hData.amount}`,
                        amount: hData.amount,
                        type: 'refund',
                        timestamp: serverTimestamp()
                    });
                    

                    await batch.commit();
                    showToast('คืนแต้มและของรางวัลเรียบร้อย');
                }
            );
            return;
        }

        // กรณีเป็นรายการทั่วไป (Add Point / Remove Point / Punishment)
        // ถามแค่ว่าจะลบ Log หรือไม่ (หรือจะทำ Reverse แต้มก็ได้ แต่เอาแค่ลบ Log ก่อนตาม Standard)
        showConfirmModal('ลบรายการ', 'ยืนยันลบรายการประวัตินี้? (ผลของแต้มจะไม่เปลี่ยนแปลง)', async () => {
            await deleteDoc(historyRef);
            showToast('ลบรายการเรียบร้อย');
        });

    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

// 7. Helpers
window.showToast = (msg) => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg mb-2 text-sm';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

window.filterStudents = renderStudentList;

// 1. ฟังก์ชันลบนักเรียน (แบบถอนรากถอนโคน)
window.deleteStudent = async (docId) => {
    try {
        const studentRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', docId);
        const sSnap = await getDoc(studentRef);
        
        if (!sSnap.exists()) return alert('ไม่พบข้อมูลนักเรียน');
        const sData = sSnap.data();
        
        if(!confirm(`⚠️ ยืนยันลบนักเรียน "${sData.full_name}"?\n\n(ระบบจะลบข้อมูลพอร์ตหุ้น และประวัติการใช้งานทั้งหมดของคนนี้ออกด้วย)`)) return;

        const batch = writeBatch(db);
        
        // 1. ลบเอกสารข้อมูลนักเรียน
        batch.delete(studentRef);

        // 2. ลบประวัติทั้งหมด (History) ที่เกี่ยวข้องกับรหัสนักเรียนนี้
        if (sData.student_id) {
            // ค้นหา History ทุกอันที่เป็นของเด็กคนนี้
            const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'history'), 
                           where('student_id', '==', sData.student_id));
            
            const historySnaps = await getDocs(q);
            historySnaps.forEach(hDoc => {
                batch.delete(hDoc.ref);
            });
        }

        await batch.commit();
        showToast(`ลบนักเรียน ${sData.full_name} และประวัติเรียบร้อยแล้ว`);

    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

// 2. ฟังก์ชันล้าง Live Feed ทั้งหมด (Clear All)
window.clearAllStockHistory = async () => {
    if(!confirm('⚠️ ยืนยัน "ล้างกระดาน Live Feed" ทั้งหมด?\n\n(ประวัติการซื้อขาย/ปันผล ในหน้า Live Feed จะหายไปทั้งหมด แต่พอร์ตหุ้นของนักเรียนจะยังอยู่ปกตินะครับ)')) return;
    
    try {
        // ลบเฉพาะ History ที่เกี่ยวกับหุ้น (stock_trade, dividend, stock_delist)
        const typesToDelete = ['stock_trade', 'dividend', 'stock_delist'];
        const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'history'), 
                       where('type', 'in', typesToDelete));
        
        const snaps = await getDocs(q);
        
        // หมายเหตุ: Batch ลบได้ทีละ 500 ถ้าประวัติเยอะมากอาจต้องวนลูป แต่สำหรับห้องเรียน Batch เดียวเอาอยู่ครับ
        const batch = writeBatch(db);
        let count = 0;

        snaps.forEach(doc => {
            batch.delete(doc.ref);
            count++;
        });
        
        if (count === 0) return alert('ไม่มีประวัติให้ลบครับ');

        await batch.commit();
        alert(`✅ ล้างประวัติไปทั้งหมด ${count} รายการเรียบร้อย!`);
        
        // รีเฟรชหน้าจอทันที
        if(window.renderMarketActivity) renderMarketActivity();

    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

window.confirmBulkDelete = () => {
    if (selectedStudentIds.size === 0) return alert('กรุณาเลือกนักเรียนก่อน');
    
    showConfirmModal('ลบนักเรียน', `ยืนยันลบนักเรียน ${selectedStudentIds.size} คน? (ประวัติการใช้งานทั้งหมดจะถูกลบไปด้วย)`, async () => {
        const batch = writeBatch(db);
        let historyDeleteCount = 0;
        
        // เตรียม Array ของ Promise เพื่อดึงข้อมูลประวัติของทุกคนพร้อมกัน
        const historyQueries = [];
        
        selectedStudentIds.forEach(id => {
            // 1. ลบตัวนักเรียน
            batch.delete(doc(db, 'artifacts', appId, 'public', 'data', 'students', id));
            
            // 2. สร้าง Query หาประวัติของคนนี้
            const q = query(collections.history(), where("student_id", "==", id));
            historyQueries.push(getDocs(q));
        });

        try {
            // รอให้ดึงประวัติของทุกคนเสร็จ
            const historySnapshots = await Promise.all(historyQueries);
            
            // วนลูปเพื่อสั่งลบประวัติที่เจอ
            historySnapshots.forEach(snap => {
                snap.forEach(doc => {
                    batch.delete(doc.ref);
                    historyDeleteCount++;
                });
            });

            await batch.commit();
            showToast(`ลบนักเรียน ${selectedStudentIds.size} คน และประวัติ ${historyDeleteCount} รายการ`);

            // เคลียร์ค่าต่างๆ
            selectedStudentIds.clear();
            document.querySelectorAll('.student-check').forEach(c => c.checked = false);
            document.getElementById('select-all').checked = false;
            updateBulkUI();
            renderStudentList(false);

        } catch (e) {
            console.error(e);
            alert('เกิดข้อผิดพลาดในการลบ: ' + e.message);
        }
    });
};

window.confirmDeleteAllHistory = () => {
    showConfirmModal('ล้างประวัติทั้งหมด', 'ยืนยันล้างประวัติทั้งหมด? (ไม่สามารถกู้คืนได้)', async () => {
        const q = query(collections.history());
        const snapshot = await getDocs(q);
        const batch = writeBatch(db);
        snapshot.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        showToast('ล้างประวัติเรียบร้อย');
    });
};

// --- SYSTEM BACKUP (EXPORT) ---
window.exportSystemData = async () => {
    if (!auth.currentUser) return alert('Session หลุด! กรุณารีเฟรชหน้าจอ');
    
    try {
        showToast('กำลังรวบรวมข้อมูลเพื่อสำรอง... ⏳');
        
        // 1. ดึงข้อมูลจากทุก Collection
        // ใช้ Promise.all เพื่อดึงพร้อมกัน 4 ทาง (เร็วขึ้น)
        const [stdSnap, rewardSnap, histSnap, cfgSnap] = await Promise.all([
            getDocs(collections.students()),
            getDocs(collections.rewards()),
            getDocs(collections.history()),
            getDocs(collections.config())
        ]);

        // 2. จัดรูปแบบข้อมูล
        const backupData = {
            meta: {
                exported_at: new Date().toISOString(),
                exported_by: 'Teacher Admin',
                system_version: '1.0'
            },
            stats: {
                students: stdSnap.size,
                rewards: rewardSnap.size,
                history: histSnap.size
            },
            data: {
                students: stdSnap.docs.map(d => ({ doc_id: d.id, ...d.data() })),
                rewards: rewardSnap.docs.map(d => ({ doc_id: d.id, ...d.data() })),
                history: histSnap.docs.map(d => ({ doc_id: d.id, ...d.data() })),
                config: cfgSnap.docs.map(d => ({ doc_id: d.id, ...d.data() }))
            }
        };

        // 3. แปลงเป็นข้อความ JSON
        const jsonStr = JSON.stringify(backupData, null, 2);
        
        // 4. สร้างไฟล์และสั่งดาวน์โหลด
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        // ตั้งชื่อไฟล์ระบุวันที่ชัดเจน เช่น backup_2025-10-28.json
        const dateStr = new Date().toISOString().slice(0,10);
        a.href = url;
        a.download = `student_points_backup_${dateStr}.json`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast(`✅ สำรองข้อมูลเรียบร้อย! (${backupData.stats.students} นักเรียน)`);

    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาดในการสำรองข้อมูล: ' + e.message);
    }
};

// --- SYSTEM RESTORE (IMPORT) ---
window.handleRestoreFile = async (el) => {
    const file = el.files[0];
    if (!file) return;
    
    if (!auth.currentUser) return alert('Session หลุด! กรุณารีเฟรชหน้าจอ');

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const json = JSON.parse(event.target.result);
            
            // ตรวจสอบความถูกต้องของไฟล์คร่าวๆ
            if (!json.meta || !json.data) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง (ไม่ใช่ไฟล์ Backup ของระบบนี้)');
            
            const confirmMsg = `ยืนยันการกู้คืนข้อมูลจากวันที่:\n📅 ${new Date(json.meta.exported_at).toLocaleString('th-TH')}\n\nข้อมูลในไฟล์:\n- นักเรียน: ${json.stats.students} คน\n- รางวัล: ${json.stats.rewards} รายการ\n- ประวัติ: ${json.stats.history} รายการ\n\n⚠️ ข้อมูลปัจจุบันที่มี ID ตรงกันจะถูกเขียนทับ ยืนยันหรือไม่?`;
            
            if (!confirm(confirmMsg)) {
                el.value = ''; // เคลียร์ไฟล์ถ้ากดยกเลิก
                return;
            }

            showToast('กำลังกู้คืนข้อมูล... กรุณารอสักครู่ (ห้ามปิดหน้าจอ) ⏳');

            // ฟังก์ชันช่วยบันทึกข้อมูลทีละ Batch (เพื่อไม่ให้เกิน Limit ของ Firestore)
            const restoreCollection = async (colName, items) => {
                if (!items || items.length === 0) return;
                
                let batch = writeBatch(db);
                let count = 0;
                
                for (const item of items) {
                    const docId = item.doc_id || item.id; // ใช้ doc_id ที่เรา export มา
                    if (!docId) continue;

                    const { doc_id, ...data } = item; // ตัด doc_id ออกจากเนื้อข้อมูล
                    
                    // ใช้ set แบบ merge: true หรือไม่ก็ได้ แต่กรณี Restore ทับ ผมแนะนำ set ปกติเพื่อให้ข้อมูลเหมือน Backup เป๊ะๆ
                    const ref = doc(db, 'artifacts', appId, 'public', 'data', colName, docId);
                    batch.set(ref, data);
                    
                    count++;
                    // ถ้าครบ 400 รายการ ให้บันทึกก่อนรอบนึง (กันเหนียว Limit 500)
                    if (count >= 400) {
                        await batch.commit();
                        batch = writeBatch(db);
                        count = 0;
                    }
                }
                
                // บันทึกเศษที่เหลือ
                if (count > 0) await batch.commit();
            };

            // เริ่มกระบวนการ Restore ทีละส่วน
            await restoreCollection('students', json.data.students);
            await restoreCollection('rewards', json.data.rewards);
            await restoreCollection('history', json.data.history);
            await restoreCollection('config', json.data.config);

            showToast('✅ กู้คืนข้อมูลสำเร็จเรียบร้อย!');
            
            // รีเฟรชหน้าจอเพื่อให้ข้อมูลใหม่แสดงผล
            setTimeout(() => {
                alert('กู้คืนข้อมูลเสร็จสิ้น ระบบจะรีเฟรชหน้าจอ');
                location.reload();
            }, 1500);

        } catch (e) {
            console.error(e);
            alert('เกิดข้อผิดพลาด: ' + e.message);
        } finally {
            el.value = ''; // เคลียร์ช่องเลือกไฟล์
        }
    };
    
    reader.readAsText(file);
};


// --- QUESTS SYSTEM ---
window.showAddQuestModal = () => document.getElementById('add-quest-modal').classList.remove('hidden');

window.handleAddQuest = async (e) => {
    e.preventDefault();
    await addDoc(collections.quests(), {
        title: document.getElementById('add-quest-title').value,
        icon: document.getElementById('add-quest-icon').value || '✨',
        points: parseInt(document.getElementById('add-quest-points').value),
        category: document.getElementById('add-quest-category').value,
        created_at: serverTimestamp()
    });
    document.getElementById('add-quest-modal').classList.add('hidden');
    e.target.reset();
    showToast('สร้างภารกิจสำเร็จ');
};

// ✅ อัปเดต: renderQuests รองรับการค้นหา
window.renderQuests = () => {
    const tbody = document.getElementById('quests-list-table');
    if (!tbody) return;

    // รับค่าจากช่องค้นหา (ถ้ามี)
    const searchInput = document.getElementById('quest-search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // 1. กรองข้อมูล (หมวดหมู่ + คำค้นหา)
    let displayQuests = quests.filter(q => {
        const matchesCategory = currentCategoryFilter === 'all' || (q.category || 'ทั่วไป') === currentCategoryFilter;
        const matchesSearch = q.title.toLowerCase().includes(searchTerm);
        return matchesCategory && matchesSearch;
    });

    // 2. เรียงลำดับ
    displayQuests.sort((a,b) => (a.category || 'ทั่วไป').localeCompare(b.category || 'ทั่วไป'));

    if (displayQuests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-400">ไม่พบภารกิจ</td></tr>`;
        return;
    }

    // 3. Render
    tbody.innerHTML = displayQuests.map(q => {
        const catName = q.category || 'ทั่วไป';
        return `
        <tr class="hover:bg-indigo-50/50 transition-colors group">
            <td class="px-6 py-4 text-center text-2xl">${q.icon}</td>
            <td class="px-6 py-4">
                <div class="font-bold text-gray-800">${q.title}</div>
            </td>
            <td class="px-6 py-4 text-center">
                <span class="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded-full border border-gray-200 font-bold">${catName}</span>
            </td>
            <td class="px-6 py-4 text-center font-bold text-green-600">+${(q.points).toLocaleString()}</td>
            <td class="px-6 py-4 text-center">
                <div class="flex justify-center gap-2">
                    <button onclick="executeBulkQuest('${q.id}')" class="bg-indigo-100 hover:bg-indigo-600 hover:text-white text-indigo-600 p-2 rounded-lg transition-colors font-bold text-xs flex items-center gap-1" title="แจกแต้ม">
                        ⚡ แจก
                    </button>
                    <button onclick="openEditQuestModal('${q.id}')" class="bg-white border border-gray-200 hover:bg-gray-100 text-gray-500 p-2 rounded-lg transition-colors" title="แก้ไข">
                        ✏️
                    </button>
                    <button onclick="deleteQuest('${q.id}')" class="bg-white border border-red-200 hover:bg-red-50 text-red-500 p-2 rounded-lg transition-colors" title="ลบ">
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
};

window.deleteQuest = async (id) => {
    if(confirm('ลบภารกิจนี้?')) await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'quests', id));
};

// เปิด Modal แก้ไขภารกิจ
window.openEditQuestModal = (id) => {
    const q = quests.find(item => item.id === id);
    if(!q) return;

    document.getElementById('edit-quest-id').value = id;
    document.getElementById('edit-quest-title').value = q.title;
    document.getElementById('edit-quest-icon').value = q.icon;
    document.getElementById('edit-quest-points').value = q.points;
    const catSelect = document.getElementById('edit-quest-category');
    if(catSelect) catSelect.value = q.category || questCategories[0];

    document.getElementById('edit-quest-modal').classList.remove('hidden');
};

// บันทึกการแก้ไขภารกิจ
window.handleEditQuestSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-quest-id').value;
    
    const updates = {
        title: document.getElementById('edit-quest-title').value,
        icon: document.getElementById('edit-quest-icon').value || '✨',
        points: parseInt(document.getElementById('edit-quest-points').value),
        category: document.getElementById('edit-quest-category').value
    };

    try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'quests', id), updates);
        document.getElementById('edit-quest-modal').classList.add('hidden');
        showToast('แก้ไขภารกิจเรียบร้อย ✅');
    } catch (error) {
        console.error(error);
        alert('เกิดข้อผิดพลาด: ' + error.message);
    }
};



// Bulk Quest Assignment
// --- ส่วนที่แก้ไข: เพิ่มตัวแปรและปรับ Logic ภารกิจ ---

let currentQuestTargetId = null;
// ✅ อัปเดต: เปิด Modal แล้วเรียกฟังก์ชัน Render
window.showBulkQuestModal = (singleId = null) => {
    currentQuestTargetId = singleId;
    const qtyInput = document.getElementById('bulk-quest-qty');
    if(qtyInput) qtyInput.value = 1;

    if (!singleId && selectedStudentIds.size === 0) return alert('กรุณาเลือกนักเรียนก่อน');

    let names = '';
    if (singleId) {
        const s = students.find(std => std.id === singleId);
        names = s ? s.full_name : '';
    } else {
        names = Array.from(selectedStudentIds).map(id => {
            const s = students.find(std => std.id === id);
            return s ? s.full_name : '';
        }).filter(n => n).join(', ');
    }

    const previewEl = document.getElementById('bulk-quest-students-preview');
    if(previewEl) {
        previewEl.textContent = names ? `กำลังทำรายการให้: ${names}` : '';
    }
    
    // เคลียร์ค่าค้นหาเก่า
    const searchInput = document.getElementById('bulk-quest-search');
    if(searchInput) searchInput.value = '';

    // เรียกวาดรายการ
    renderBulkQuestList();
    
    document.getElementById('bulk-quest-modal').classList.remove('hidden');
};

// ✅ ฟังก์ชันใหม่: แสดงรายการใน Modal แบบมีค้นหา
window.renderBulkQuestList = () => {
    const container = document.getElementById('bulk-quest-list');
    const searchInput = document.getElementById('bulk-quest-search');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    if (!container) return;

    // กรองตามคำค้นหา
    const filteredQuests = quests.filter(q => q.title.toLowerCase().includes(searchTerm));

    if (filteredQuests.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 py-4">ไม่พบภารกิจที่ค้นหา</p>';
    } else {
        container.innerHTML = filteredQuests.map(q => `
            <button onclick="executeBulkQuest('${q.id}')" class="w-full flex items-center justify-between p-3 bg-white border hover:border-indigo-500 hover:bg-indigo-50 rounded-lg transition-all group">
                <div class="flex items-center gap-3">
                    <span class="text-2xl">${q.icon}</span>
                    <span class="font-bold text-gray-700 group-hover:text-indigo-700 text-left">${q.title}</span>
                </div>
                <span class="font-bold text-green-600 whitespace-nowrap">+${(q.points).toLocaleString()}</span>
            </button>
        `).join('');
    }
};

window.adjustBulkQuestQty = (delta) => {
const input = document.getElementById('bulk-quest-qty');
let val = parseInt(input.value) || 1;
val += delta;
if (val < 1) val = 1;
input.value = val;
};

// 🔥 ฟังก์ชันช่วยคำนวณแต้มรวมบัฟ (Quest + Guild + Personal)
window.calculateQuestPointsWithBuffs = (student, basePoints) => {
    let bonusPercent = 0;

    // 1. เช็คบัฟกิลด์ (Guild Buff)
    if (student.guild_id && typeof getGuildActiveBuffs === 'function') {
        const gBuffs = getGuildActiveBuffs(student.guild_id);
        // ตรวจสอบว่ามีค่า point_boost หรือไม่ (หน่วยเป็น %)
        if (gBuffs && gBuffs.point_boost) {
            bonusPercent += parseFloat(gBuffs.point_boost) || 0;
        }
    }

    // 2. เช็คบัฟส่วนตัว (Personal Buff from Gacha/Item)
    if (student.buff_points_end) {
        let endTime = student.buff_points_end;
        // แปลง Timestamp เป็น Milliseconds
        if (typeof endTime.toMillis === 'function') endTime = endTime.toMillis();
        else if (endTime instanceof Date) endTime = endTime.getTime();
        
        // ถ้าเวลายังไม่หมดอายุ ให้บวก % เพิ่ม
        if (Date.now() < endTime) {
            bonusPercent += parseFloat(student.buff_points_val) || 0;
        }
    }

    // คำนวณแต้มสุทธิ
    // สูตร: ฐาน + (ฐาน * %โบนัส / 100)
    const bonusPoints = Math.floor(basePoints * bonusPercent / 100);
    const totalPoints = basePoints + bonusPoints;

    return { totalPoints, bonusPoints, bonusPercent };
};


window.executeBulkQuest = async (questId) => {
    const quest = quests.find(q => q.id === questId);
    if (!quest) return;
    
    // ดึงจำนวนครั้งจากช่องกรอก
    const qtyInput = document.getElementById('bulk-quest-qty');
    const qty = parseInt(qtyInput ? qtyInput.value : 1) || 1;
    
    // แต้มตั้งต้น (Base Points)
    const baseTotalPoints = quest.points * qty;

    const batch = writeBatch(db);
    const timestamp = serverTimestamp();
    let count = 0;
    let totalBonusGiven = 0; // เก็บสถิติโบนัสที่แจกไป
    let totalBossDamage = 0;

    const targetIds = currentQuestTargetId ? [currentQuestTargetId] : Array.from(selectedStudentIds);
    let contributorsMap = {}; // 🔥 1. สร้างตัวแปร Map

    targetIds.forEach(sid => {
        const s = students.find(std => std.id === sid);
        
        if (s) {
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', sid);
            const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
            
            // 🔥 เรียกใช้ฟังก์ชันคำนวณบัฟตรงนี้!
            const { totalPoints, bonusPoints, bonusPercent } = calculateQuestPointsWithBuffs(s, baseTotalPoints);
            totalBonusGiven += bonusPoints;
            totalBossDamage += totalPoints;
            contributorsMap[sid] = totalPoints;

            // ข้อความบันทึกประวัติ (เพิ่มรายละเอียดบัฟถ้ามี)
            let historyAction = `ภารกิจสำเร็จ: ${quest.title} (x${qty})`;
            if (bonusPoints > 0) {
                historyAction += ` [Buff +${bonusPercent}%]`;
            }

            // เช็คใบเตือน (ถ้ามีให้เข้า pending_points)
            if ((s.warning_cards || 0) > 0) {
                batch.update(sRef, { pending_points: increment(totalPoints) });
            } else {
                batch.update(sRef, { points: increment(totalPoints) });
            }

            batch.set(hRef, {
                student_id: s.id,
                student_name: s.full_name,
                action: historyAction,
                amount: totalPoints, // บันทึกยอดสุทธิ (รวมโบนัสแล้ว)
                type: 'quest_complete',
                timestamp: timestamp
            });
            count++;
        }
    });

    await batch.commit();
    // 🔥 3. ส่งไปตีบอส
    if (Object.keys(contributorsMap).length > 0) {
        await autoDamageBoss(contributorsMap);
    }
    const bulkModal = document.getElementById('bulk-quest-modal');
    if(bulkModal) bulkModal.classList.add('hidden');
    
    // แจ้งเตือนสรุป
    let msg = `มอบรางวัลภารกิจให้ ${count} คน เรียบร้อย!`;
    if (totalBonusGiven > 0) msg += ` (รวมโบนัสบัฟ ${totalBonusGiven} แต้ม)`;
    showToast(msg);
    
    if (!currentQuestTargetId) {
            selectedStudentIds.clear();
            if(typeof updateBulkUI === 'function') updateBulkUI();
    }
    currentQuestTargetId = null;
    if(typeof renderStudentList === 'function') renderStudentList(false);
};



// --- ITEM & INVENTORY SYSTEM ---

// UI Helper for Add Reward Modal
window.toggleRewardTypeInputs = () => {
    const type = document.getElementById('add-reward-type').value;
    const isGacha = type === 'gacha_custom';
    
    // 1. จัดการ Item Effect
    const itemEffect = document.getElementById('item-effect-container');
    if(itemEffect) itemEffect.classList.toggle('hidden', type !== 'item');

    // 2. จัดการ Gacha Builder
    const gachaBuilder = document.getElementById('gacha-builder-container');
    if(gachaBuilder) gachaBuilder.classList.toggle('hidden', !isGacha);

    // 3. 🟢 [ส่วนใหม่] ซ่อนโควตาถ้าเป็น Gacha
  /*  const quotaInput = document.getElementById('add-reward-quota');
    if (quotaInput && quotaInput.parentElement) {
         // ซ่อนทั้งก้อน (Label + Input + Checkbox)
         quotaInput.parentElement.classList.toggle('hidden', isGacha);
    } */
};


window.addGachaSlot = () => {
    const container = document.getElementById('gacha-slots-list');
    
    let rewardOptions = rewards
        .filter(r => r.type !== 'gacha_custom') 
        .map(r => `<option value="${r.id}">${r.name}</option>`)
        .join('');

    const div = document.createElement('div');
    div.className = 'bg-white p-3 rounded border border-amber-100 shadow-sm relative gacha-slot-item';
    div.innerHTML = `
        <div class="flex gap-2 mb-2">
            <select class="border rounded text-sm px-2 py-1 bg-gray-50 flex-1 slot-type min-w-0 w-[55%]" onchange="updateSlotInputs(this)">
                <option value="points">💰 สุ่มแต้ม (ช่วง Min-Max)</option>
                <option value="points_fix">💎 สุ่มแต้ม (Fix ค่าเดียว)</option>
                <option value="interest">📈 ดอกเบี้ยพิเศษ</option>
                <option value="buff_discount">🏷️ บัฟส่วนลดร้านค้า</option> 
                <option value="buff_points">🚀 บูสต์แต้ม (Multiplier)</option>
                <option value="reward_ref">🎁 ของในร้าน</option>
                <option value="text">💬 ข้อความ/กำหนดเอง</option>
                <option value="salt">🧂 เกลือ (ไม่ได้อะไรเลย)</option> 
            </select>
            <div class="flex items-center gap-1 w-[30%]">
                <input type="number" step="0.01" class="border rounded text-sm px-2 py-2 w-full text-center font-bold text-blue-600 slot-chance" placeholder="%" oninput="updateTotalChance()">
                <span class="text-xs text-gray-400">%</span>
            </div>
            <button type="button" onclick="this.parentElement.parentElement.remove(); updateTotalChance()" class="text-red-400 hover:text-red-600">×</button>
        </div>
        
        <div class="slot-inputs text-sm space-y-2">
            <div class="input-points flex gap-2 items-center">
                <span>จาก</span> <input type="number" min="0" class="border rounded w-20 px-2 py-1 slot-min" placeholder="Min">
                <span>ถึง</span> <input type="number" min="0" class="border rounded w-20 px-2 py-1 slot-max" placeholder="Max"> แต้ม
            </div>
            <div class="input-points_fix hidden flex flex-col gap-2">
                <div class="flex gap-2 items-center">
                    <span>ได้รับ</span> <input type="number" min="1" class="border rounded w-24 px-2 py-1 slot-fix-amount font-bold text-green-600" placeholder="จำนวน"> แต้ม
                </div>
                <input type="text" class="border rounded w-full px-2 py-1 slot-fix-image" placeholder="URL รูปภาพคูปอง (ถ้ามี ใส่ลิ้งค์รูปตรงนี้)">
            </div>

            <div class="input-buff_discount hidden space-y-1">
                 <div class="flex gap-2 items-center">
                    <span>ส่วนลดเพิ่ม</span> <input type="number" min="1" max="100" class="border rounded w-20 px-2 py-1 slot-value font-bold text-red-500" placeholder="%"> %
                 </div>
                 <div class="flex gap-2 items-center">
                    <span>นาน</span> <input type="number" min="1" class="border rounded w-20 px-2 py-1 slot-duration" placeholder="ชม." value="1"> ชั่วโมง
                 </div>
            </div>
            <div class="input-reward_ref hidden">
                <select class="border rounded w-full px-2 py-1 slot-reward-id">
                    ${rewardOptions}
                </select>
            </div>
            <div class="input-text hidden">
                <input type="text" class="border rounded w-full px-2 py-1 slot-text" placeholder="เช่น สิทธิ์เลือกเพลง, สอบแก้ตัวฟรี">
            </div>
            <div class="input-salt hidden">
                <input type="text" class="border rounded w-full px-2 py-1 slot-text" value="เกลือจ้า! ไม่ได้อะไรเลย" placeholder="ข้อความเยาะเย้ย">
            </div>

            <div class="input-interest hidden space-y-1">
                <div class="flex gap-2 items-center">
                    <span>ดอกเบี้ยเพิ่ม</span> <input type="number" step="0.001" min="0.001" class="border rounded w-24 px-2 py-1 slot-rate font-bold text-green-600" placeholder="%"> %
                </div>
                <div class="flex gap-2 items-center">
                    <span>นาน</span> <input type="number" step="0.1" min="0.1" class="border rounded w-20 px-2 py-1 slot-hours" placeholder="ชม."> ชั่วโมง
                </div>
                <p class="text-[10px] text-gray-400">* 24 ชม. = 1 วัน</p>
            </div>

            <div class="input-buff_points hidden space-y-1">
                <div class="flex gap-2 items-center">
                    <span>เพิ่ม</span> <input type="number" min="1" class="border rounded w-20 px-2 py-1 slot-value font-bold text-blue-500" placeholder="%"> %
                </div>
                <div class="flex gap-2 items-center">
                    <span>นาน</span> <input type="number" min="1" class="border rounded w-20 px-2 py-1 slot-duration" placeholder="ชม." value="1"> ชั่วโมง
                </div>
            </div>
        </div>
    `;
    container.appendChild(div);
};

// --- Edit Mode Helpers ---
window.toggleEditRewardTypeInputs = () => {
    const type = document.getElementById('edit-reward-type').value;
    const isGacha = type === 'gacha_custom';
    
    const gachaBuilder = document.getElementById('edit-gacha-builder-container');
    if(gachaBuilder) gachaBuilder.classList.toggle('hidden', !isGacha);

    // 🟢 [ส่วนใหม่] ซ่อนโควตาถ้าเป็น Gacha
  /*  const quotaInput = document.getElementById('edit-reward-quota');
    if (quotaInput && quotaInput.parentElement) {
         quotaInput.parentElement.classList.toggle('hidden', isGacha);
    } */
};

window.addEditGachaSlot = (data = null) => {
    const container = document.getElementById('edit-gacha-slots-list');
    let rewardOptions = rewards
        .filter(r => r.type !== 'gacha_custom')
        .map(r => `<option value="${r.id}">${r.name}</option>`)
        .join('');

    const div = document.createElement('div');
    div.className = 'bg-white p-3 rounded border border-amber-100 shadow-sm relative edit-gacha-slot-item';
    div.innerHTML = `
        <div class="flex gap-2 mb-2">
            <select class="border rounded text-sm px-2 py-1 bg-gray-50 flex-1 slot-type min-w-0 w-[55%]" onchange="updateEditSlotInputs(this)">
                <option value="points">💰 สุ่มแต้ม (ช่วง Min-Max)</option>
                <option value="points_fix">💎 สุ่มแต้ม (Fix ค่าเดียว)</option>
                <option value="interest">📈 ดอกเบี้ยพิเศษ</option>
                <option value="buff_discount">🏷️ บัฟส่วนลดร้านค้า</option>
                <option value="buff_points">🚀 บูสต์แต้ม (Multiplier)</option>
                 <option value="reward_ref">🎁 ของในร้าน</option>
                <option value="text">💬 ข้อความ/กำหนดเอง</option>
                <option value="salt">🧂 เกลือ (ไม่ได้อะไรเลย)</option>
            </select>
            <div class="flex items-center gap-1 w-[30%]">
                <input type="number" step="0.01" class="border rounded text-sm px-2 py-2 w-full text-center font-bold text-blue-600 slot-chance" placeholder="%" oninput="updateEditTotalChance()">
                <span class="text-xs text-gray-400">%</span>
            </div>
            <button type="button" onclick="this.parentElement.parentElement.remove(); updateEditTotalChance()" class="text-red-400 hover:text-red-600">×</button>
        </div>
        
        <div class="slot-inputs text-sm space-y-2">
            <div class="input-points flex gap-2 items-center hidden">
                <span>จาก</span> <input type="number" min="0" class="border rounded w-20 px-2 py-1 slot-min" placeholder="Min">
                <span>ถึง</span> <input type="number" min="0" class="border rounded w-20 px-2 py-1 slot-max" placeholder="Max"> แต้ม
            </div>
            <div class="input-points_fix hidden flex flex-col gap-2">
                <div class="flex gap-2 items-center">
                    <span>ได้รับ</span> <input type="number" min="1" class="border rounded w-24 px-2 py-1 slot-fix-amount font-bold text-green-600" placeholder="จำนวน"> แต้ม
                </div>
                <input type="text" class="border rounded w-full px-2 py-1 slot-fix-image" placeholder="URL รูปภาพคูปอง (ถ้ามี)">
            </div>

            <div class="input-buff_discount hidden space-y-1">
                 <div class="flex gap-2 items-center">
                    <span>ส่วนลดเพิ่ม</span> <input type="number" min="1" max="100" class="border rounded w-20 px-2 py-1 slot-value font-bold text-red-500" placeholder="%"> %
                 </div>
                 <div class="flex gap-2 items-center">
                    <span>นาน</span> <input type="number" min="1" class="border rounded w-20 px-2 py-1 slot-duration" placeholder="ชม." value="1"> ชั่วโมง
                 </div>
            </div>
            <div class="input-reward_ref hidden">
                <select class="border rounded w-full px-2 py-1 slot-reward-id">${rewardOptions}</select>
            </div>
            <div class="input-text hidden">
                <input type="text" class="border rounded w-full px-2 py-1 slot-text" placeholder="ระบุข้อความ">
            </div>
            <div class="input-salt hidden">
                <input type="text" class="border rounded w-full px-2 py-1 slot-text" value="เกลือจ้า! ไม่ได้อะไรเลย" placeholder="ข้อความเยาะเย้ย">
            </div>
            <div class="input-interest hidden space-y-1">
              <div class="flex gap-2 items-center">
                <span>ดอกเบี้ยเพิ่ม</span> <input type="number" step="0.001" min="0.001" class="border rounded w-24 px-2 py-1 slot-rate font-bold text-green-600" placeholder="%"> %
              </div>
            <div class="flex gap-2 items-center">
                <span>นาน</span> <input type="number" step="0.1" min="0.1" class="border rounded w-20 px-2 py-1 slot-hours" placeholder="ชม."> ชั่วโมง
            </div>
            <p class="text-[10px] text-gray-400">* 24 ชม. = 1 วัน</p>
            </div>

            <div class="input-buff_points hidden space-y-1">
                <div class="flex gap-2 items-center">
                <span>เพิ่ม</span> <input type="number" min="1" class="border rounded w-20 px-2 py-1 slot-value font-bold text-blue-500" placeholder="%"> %
                </div>
            <div class="flex gap-2 items-center">
                <span>นาน</span> <input type="number" min="1" class="border rounded w-20 px-2 py-1 slot-duration" placeholder="ชม." value="1"> ชั่วโมง
            </div>
        </div>
            
        </div>
    `;
    container.appendChild(div);

    if (data) {
        div.querySelector('.slot-type').value = data.type;
        div.querySelector('.slot-chance').value = data.chance;
        
        updateEditSlotInputs(div.querySelector('.slot-type'));

        if (data.type === 'points') {
            div.querySelector('.slot-min').value = data.min;
            div.querySelector('.slot-max').value = data.max;
        } 
        // ✨ โหลดข้อมูล Fix
        else if (data.type === 'points_fix') {
            div.querySelector('.slot-fix-amount').value = data.amount;
            div.querySelector('.slot-fix-image').value = data.image || '';
        }
         else if (data.type === 'interest') {
            div.querySelector('.slot-rate').value = data.rate;
            div.querySelector('.slot-hours').value = data.hours;
        } else if (data.type === 'reward_ref') {
            div.querySelector('.slot-reward-id').value = data.reward_id;
        } else if (data.type === 'text' || data.type === 'salt') {
            div.querySelector('.slot-text').value = data.text;
        } 
        else if (data.type === 'buff_discount') {
            div.querySelector('.slot-value').value = data.value;
            div.querySelector('.slot-duration').value = data.duration;
        }
        else if (data.type === 'buff_points') {
            div.querySelector('.input-buff_points .slot-value').value = data.value;
            div.querySelector('.input-buff_points .slot-duration').value = data.duration;
        }
    }
    updateEditTotalChance();
};

window.updateEditSlotInputs = (selectEl) => {
    const type = selectEl.value;
    const parent = selectEl.closest('.edit-gacha-slot-item');
    parent.querySelectorAll('.slot-inputs > div').forEach(el => el.classList.add('hidden'));
    const target = parent.querySelector(`.input-${type}`);
    if(target) target.classList.remove('hidden');
};

window.updateEditTotalChance = () => {
    let total = 0;
    // ค้นหาเฉพาะใน Container ของ Edit
    const container = document.getElementById('edit-gacha-slots-list');
    if(container) {
        container.querySelectorAll('.slot-chance').forEach(el => total += (parseFloat(el.value) || 0));
        const display = document.getElementById('edit-gacha-total-chance');
        display.textContent = total;
        display.className = total === 100 ? 'font-bold text-green-600' : 'font-bold text-red-600';
    }
};


// เพิ่มส่วนนี้เข้าไปเพื่อให้ช่องกรอกข้อมูลโชว์เวลาเลือกประเภท [cite: 635-636]
window.updateSlotInputs = (selectEl) => {
    const type = selectEl.value;
    const parent = selectEl.closest('.gacha-slot-item');
    parent.querySelectorAll('.slot-inputs > div').forEach(el => el.classList.add('hidden'));
    parent.querySelector(`.input-${type}`).classList.remove('hidden');
};

// เพิ่มส่วนนี้เพื่อคำนวณ % รวม 
// ฟังก์ชันคำนวณ % รวม (สำหรับหน้าเพิ่มรางวัล) - แก้ไขบั๊กนับรวมหน้า Edit
window.updateTotalChance = () => {
    let total = 0;
    // ระบุเจาะจงว่าหาเฉพาะในกล่อง "gacha-slots-list" (หน้าเพิ่ม) เท่านั้น
    const container = document.getElementById('gacha-slots-list');
    if (container) {
        container.querySelectorAll('.slot-chance').forEach(el => total += (parseFloat(el.value) || 0));
    }
    
    const display = document.getElementById('gacha-total-chance');
    if (display) {
        display.textContent = total;
        display.className = total === 100 ? 'font-bold text-green-600' : 'font-bold text-red-600';
    }
};

// Modified Add Reward (Overwrite the old one or update it)
// Modified Add Reward (แก้ไข Error ให้บันทึกได้ชัวร์)
window.handleAddReward = async (e) => {
    e.preventDefault();
    const type = document.getElementById('add-reward-type').value;
    
    // --- 🟢 ส่วนที่แก้ไข: เพิ่ม Logic เช็ค "ไม่จำกัด" ---
    const isUnlimited = document.getElementById('add-reward-unlimited').checked;
    // ถ้าติ๊กไม่จำกัด ให้ค่าเป็น -1, ถ้าไม่ติ๊ก ให้เอาค่าจากช่องกรอก
    const stock = isUnlimited ? -1 : parseInt(document.getElementById('add-reward-stock').value);
    
    const isQuotaUnlimited = document.getElementById('add-reward-quota-unlimited').checked;
    const quota = isQuotaUnlimited ? 0 : (parseInt(document.getElementById('add-reward-quota').value) || 0);
    

    let gachaPool = [];
    let isValid = true;

    if (type === 'gacha_custom') 
    {
        document.querySelectorAll('.gacha-slot-item').forEach(slot => {
            if (!isValid) return; 

            const slotType = slot.querySelector('.slot-type').value;
            const chance = parseFloat(slot.querySelector('.slot-chance').value) || 0;
            
            let data = { type: slotType, chance: chance };
            
            if (slotType === 'points') {
                data.min = parseInt(slot.querySelector('.slot-min').value) || 0;
                data.max = parseInt(slot.querySelector('.slot-max').value) || 0;
                
                if (data.min < 0 || data.max < 0) {
                    alert('คะแนนสุ่มห้ามติดลบครับ');
                    isValid = false; return;
                }
                if (data.min >= data.max) {
                    alert(`ช่องสุ่มคะแนน: ค่าต่ำสุด (${data.min}) ต้อง "น้อยกว่า" ค่าสูงสุด (${data.max}) ครับ`);
                    isValid = false; return;
                }

            } 

            else if (slotType === 'points_fix') {
            // 1. ดึงค่าแต้มที่ระบุ
            data.amount = parseInt(slot.querySelector('.slot-fix-amount').value) || 0;
            
            // 2. ดึง URL รูปภาพ (ถ้ามี)
            const imgInput = slot.querySelector('.slot-fix-image');
            data.image = imgInput ? imgInput.value.trim() : '';

            // 3. ตรวจสอบความถูกต้อง
            if (data.amount <= 0) { 
                alert('จำนวนแต้มต้องมากกว่า 0'); 
                isValid = false; 
                return; 
            }
        }
             else if (slotType === 'interest') { 
                data.rate = parseFloat(slot.querySelector('.slot-rate').value) || 1.0;
                data.hours = parseFloat(slot.querySelector('.slot-hours').value) || 24;

                if (data.rate <= 0) { alert('อัตราดอกเบี้ยต้องมากกว่า 0'); isValid = false; return; }
                if (data.hours <= 0) { alert('ระยะเวลาดอกเบี้ยพิเศษต้องมากกว่า 0'); isValid = false; return; }
            }
            else if (slotType === 'buff_discount') {
                // ✅ ระบุ .input-buff_discount
                data.value = parseInt(slot.querySelector('.input-buff_discount .slot-value').value) || 0;
                data.duration = parseInt(slot.querySelector('.input-buff_discount .slot-duration').value) || 60;
                
                if (data.value <= 0) { alert('ส่วนลดต้องมากกว่า 0%'); isValid = false; return; }
            }

            else if (slotType === 'buff_points') {
                data.value = parseInt(slot.querySelector('.input-buff_points .slot-value').value) || 0;
                data.duration = parseInt(slot.querySelector('.input-buff_points .slot-duration').value) || 24;

                if (data.value <= 0) { alert('ค่าบูสต์แต้มต้องมากกว่า 0%'); isValid = false; return; }
            }
            else if (slotType === 'reward_ref') {
                data.reward_id = slot.querySelector('.slot-reward-id').value;
            } 
            // 🟢 แก้ไขตรงนี้ครับ (รวม Text และ Salt ไว้ด้วยกันให้ถูกต้อง)
            else if (slotType === 'text' || slotType === 'salt') {
                data.text = slot.querySelector('.slot-text').value;
            }
            
            gachaPool.push(data);
        });

        if (!isValid) return;

        const totalChance = gachaPool.reduce((sum, item) => sum + item.chance, 0);
        if (totalChance !== 100) {
            if(!confirm(`อัตราการออกรวมคือ ${totalChance}% (ไม่ครบ 100%)\nระบบจะถือว่าส่วนที่ขาดคือ "ไม่ได้อะไรเลย" (เกลือ)\nต้องการบันทึกหรือไม่?`)) return;
        }
    }

    const effectEl = document.getElementById('add-reward-effect');
    const effectValue = effectEl ? effectEl.value : 'none';

    const noGuild = document.getElementById('add-reward-no-guild').checked;
    const noPersonal = document.getElementById('add-reward-no-personal').checked;

    await addDoc(collections.rewards(), {
        is_active: document.getElementById('add-reward-active').checked,
        name: document.getElementById('add-reward-name').value,
        points: parseInt(document.getElementById('add-reward-points').value),
        image: document.getElementById('add-reward-img').value || '',
        stock: stock, // 🟢 ใช้ตัวแปร stock ที่เราคำนวณไว้ข้างบน (บรรทัดนี้สำคัญ!)
        quota: quota,
        type: type,
        effect: effectValue,
        gacha_pool: gachaPool,
        // ✅ บันทึกค่าใหม่ลง DB
        no_guild_discount: document.getElementById('add-reward-no-guild').checked,
        no_personal_discount: document.getElementById('add-reward-no-personal').checked,
        category: document.getElementById('add-reward-category').value
    });
    
    document.getElementById('add-reward-modal').classList.add('hidden');
    e.target.reset();
    const gachaList = document.getElementById('gacha-slots-list');
    if(gachaList) gachaList.innerHTML = ''; 
    showToast('บันทึกสำเร็จ');
};

// Modified Redeem Action (Inventory Logic) - IMPORTANT: REPLACE OLD confirmRedeemAction
// ==========================================
// ✅ ยืนยันการแลกของ (ฉบับสมบูรณ์: ตัดโควตาทุกกรณี + เข้ากระเป๋า)
// ==========================================
window.confirmRedeemAction = async () => {
    // 1. ดึงค่าตัวแปร
    const qty = parseInt(document.getElementById('redeem-qty').value);
    if (qty <= 0) return alert('กรุณาระบุจำนวนสินค้าอย่างน้อย 1 ชิ้น');
    
    if (!redeemTarget || !selectedStudentForRedeem) return;

    const reward = redeemTarget;
    const student = selectedStudentForRedeem;
    const totalCost = qty * reward.actualPrice; // ราคาหลังหักส่วนลด
    // ✅ เช็คแค่ Warning Cards (ใบเตือน) อย่างเดียว
    const warningCount = student.warning_cards || 0;
    // อนุญาตให้แลกได้เฉพาะของที่เป็น "ไอเทมล้างโทษ" (remove_warning)
    const isCureItem = reward.effect === 'remove_warning';
    const isUnlimited = reward.stock === -1;

    // เช็คว่าเป็นกาชาหรือไม่ (รองรับทั้ง type เก่าและใหม่)
    const isGacha = reward.type === 'gacha_custom' || reward.type === 'random_box'; 

    // 2. ตรวจสอบความพร้อม (Basic Check)
    if (warningCount >= 2 && !isCureItem) {
        return alert(`❌ นักเรียนมีใบเตือน (${warningCount} ใบ) (ครบ 2 ใบ) \nไม่สามารถแลกของรางวัลทั่วไปได้ครับ ต้องล้างโทษให้เหลือน้อยกว่า 2 ใบ จึงจะแลกของได้`);
    }
    if (student.points < totalCost) return alert('❌ แต้มไม่พอครับ');
    if (!isUnlimited && reward.stock < qty) return alert(`❌ ของหมด (เหลือ ${reward.stock} ชิ้น)`);

    // 3. 🛡️ เช็คโควตาการซื้อ (Purchase Quota) - ใช้กับทุกประเภท
    if (reward.quota > 0) {
        const currentRedeemed = (student.redeemed_history && student.redeemed_history[reward.id]) || 0;
        if (currentRedeemed + qty > reward.quota) {
            return alert(`❌ เกินโควตา! คุณแลกไปแล้ว ${currentRedeemed}/${reward.quota} สิทธิ์`);
        }
    }

    // 4. เตรียมบันทึกข้อมูล (Batch Write)
    const batch = writeBatch(db);
    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', student.id);
    const rRef = doc(db, 'artifacts', appId, 'public', 'data', 'rewards', reward.id);
    const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

    // --- ส่วนที่แก้ไขให้เหมือนกันหมด ---
    
    // A. ตัดแต้ม
    const updateData = { points: increment(-totalCost) };
    
    // B. ✅ ตัดโควตา (สำคัญมาก! ต้องอยู่นอก if/else เพื่อให้โดนทุกประเภท)
    const redeemedKey = `redeemed_history.${reward.id}`;
    updateData[redeemedKey] = increment(qty);

    // C. ถ้าเป็นกาชา หรือ ไอเทม -> ให้เพิ่มของเข้ากระเป๋า
    if (isGacha || reward.type === 'item') {
        const newItems = [];
        for(let i=0; i<qty; i++) {
            newItems.push({
                id: crypto.randomUUID(),
                reward_id: reward.id,
                name: reward.name,
                image: reward.image || '',
                type: isGacha ? 'gacha_box' : 'general_item', // ระบุประเภทให้ชัด
                obtained_at: Date.now(),
                // แปะข้อมูล Pool ไปด้วย เผื่อร้านค้ามีการเปลี่ยนแปลงในอนาคต กล่องนี้จะได้ยังเปิดได้
                gacha_pool: reward.gacha_pool || null 
            });
        }
        updateData.inventory = arrayUnion(...newItems);
    }

    // สั่งอัปเดตนักเรียนทีเดียว (รวมตัดแต้ม + ตัดโควตา + เพิ่มของ)
    batch.update(sRef, updateData);

    // D. ตัดสต็อกร้านค้า (ถ้ามีจำกัด)
    if (!isUnlimited) {
        batch.update(rRef, { stock: increment(-qty) });
    }
    
    // E. บันทึกประวัติ
    batch.set(hRef, {
        student_id: student.id,
        student_name: student.full_name,
        action: `แลกรางวัล: ${reward.name} (x${qty})`,
        amount: -totalCost,
        type: isGacha ? 'buy_gacha' : 'redeem',
        timestamp: serverTimestamp(),
        meta: { 
            reward_id: reward.id, 
            qty: qty, 
            is_gacha: isGacha 
        }
    });

    try {
        await batch.commit();

        // 5. อัปเดตหน้าจอทันที (Local Update)
        student.points -= totalCost;

        // อัปเดตยอดการซื้อในจอ (Quota)
        if (!student.redeemed_history) student.redeemed_history = {};
        const oldQty = student.redeemed_history[reward.id] || 0;
        student.redeemed_history[reward.id] = oldQty + qty;

        // ถ้าเป็นกาชา อัปเดตกระเป๋าในจอ
        if (isGacha || reward.type === 'item') {
            if (!student.inventory) student.inventory = [];
            for(let i=0; i<qty; i++) {
                // Mock Item เพื่อให้เห็นว่าของเข้าแล้ว
                student.inventory.push({ type: isGacha ? 'gacha_box' : 'general_item', name: reward.name, reward_id: reward.id });
            }
        }

        if (!isUnlimited) {
            reward.stock -= qty;
        }

        hideRedeemQuantityModal();
        showToast(`✅ แลกสำเร็จ! (-${totalCost} แต้ม)`);
        
        // รีเฟรชหน้าร้านค้า (เพื่อให้ปุ่มโควตาเปลี่ยนสถานะ)
        renderShopGrid();

    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

// Render Student Inventory (Call this inside renderStudentDashboard)
function renderStudentInventory(student) {
    let container = document.getElementById('std-inventory-list');
    if (!container) {
        const parent = document.getElementById('content-student-dashboard');
        const invDiv = document.createElement('div');
        invDiv.className = 'bg-white rounded-xl shadow-sm p-6 border border-gray-100';
        invDiv.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-bold text-gray-800">🎒 กระเป๋าของฉัน</h3>
                <span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded-full">แจ้งครูเมื่อต้องการใช้</span>
            </div>
            <div id="std-inventory-list" class="grid grid-cols-2 md:grid-cols-4 gap-4"></div>`;
        parent.insertBefore(invDiv, parent.children[1]);
        container = document.getElementById('std-inventory-list');
    }

    const items = student.inventory || [];
    if (items.length === 0) {
        container.innerHTML = '<p class="text-gray-400 col-span-full text-center text-sm py-4">กระเป๋าว่างเปล่า (ไปแลกของที่ร้านค้าสิ!)</p>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="border rounded-lg p-3 flex flex-col items-center bg-gray-50 relative group">
            <div class="text-3xl mb-2 transition-transform hover:scale-110 h-10 flex items-center justify-center">
${item.image || '📦'}
            </div>
            <div class="font-bold text-xs text-center text-gray-700 leading-tight">${item.name}</div>
            </div>
    `).join('');
}


// ฟังก์ชันปิด Modal Gacha (อัปเดตใหม่: รีเฟรชกระเป๋าทันที 🎉)
window.closeGachaModal = () => {
    document.getElementById('gacha-animation-modal').classList.add('hidden');

    // --- ส่วนที่เพิ่ม: อัปเดตหน้ากระเป๋าครูทันที ---
    if (currentInvStudent) {
        // ดึงข้อมูลล่าสุดจากตัวแปร global students (ซึ่งอัปเดตผ่าน Real-time Listener แล้ว)
        const latestData = students.find(s => s.id === currentInvStudent.id);
        if (latestData) {
            currentInvStudent = latestData; // อัปเดตตัวแปรที่ใช้แสดงผลให้เป็นปัจจุบัน
            renderTeacherInventory();       // สั่งวาดหน้ากระเป๋าใหม่ทันที!
        }
    }
    // ------------------------------------------

    // รีเซ็ต UI เตรียมไว้รอบหน้า
    document.getElementById('gacha-close-btn').classList.add('hidden');
    document.getElementById('gacha-anim-icon').className = 'text-[150px] mb-8 inline-block select-none drop-shadow-2xl';
    document.getElementById('gacha-anim-icon').textContent = '📦';
    document.getElementById('gacha-anim-text').textContent = 'กำลังสุ่ม...';
    document.getElementById('gacha-anim-sub').textContent = '';
};

// Modified useItem with Animation
// Modified useItem with Animation (Fixed Gacha Buff Logic)
window.useItem = async (itemId, itemName) => {
    if(!confirm(`ยืนยันการใช้ "${itemName}" ให้นักเรียน?`)) return;
    const s = currentInvStudent; 
    if (!s) return;

    const inventoryItem = s.inventory.find(i => (i.id || i.instance_id) === itemId);
    if(!inventoryItem) return alert('ไอเทมหายไปแล้ว');

    if (inventoryItem.expired_at) {
        // แปลงเวลา (รองรับทั้ง Timestamp ของ Firebase และ Text)
        const expDate = inventoryItem.expired_at.seconds 
            ? new Date(inventoryItem.expired_at.seconds * 1000) 
            : new Date(inventoryItem.expired_at);

        // ถ้าเวลาปัจจุบัน เลยเวลาหมดอายุแล้ว
        if (new Date() > expDate) {
            alert(`⛔ ไอเทมนี้หมดอายุแล้ว!\n(หมดอายุเมื่อ ${expDate.toLocaleDateString('th-TH')})\n\nระบบจะลบไอเทมทิ้งทันที`);

            // สั่งลบไอเทมออกจาก DB ทันที
            const batch = writeBatch(db);
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
            
            // กรองเอาไอเทมชิ้นนี้ออก
            const newInventory = s.inventory.filter(i => (i.id || i.instance_id) !== itemId);
            batch.update(sRef, { inventory: newInventory });
            
            await batch.commit();

            // รีเฟรชหน้าจอ
            if(typeof renderStudentList === 'function') renderStudentList(false);
            if(typeof openAdminInventory === 'function') openAdminInventory(s.id);
            
            return; // 🛑 หยุดการทำงานทันที (ห้ามไปทำบรรทัดล่างต่อ)
        }
    }

    // เตรียมตัวแปร Database
    const batch = writeBatch(db);
    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
    const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

    // LOGIC SKIN

    if (inventoryItem.type && inventoryItem.type.startsWith('skin_')) {
        let updateData = {};
        let logMsg = "";

        if (inventoryItem.type === 'skin_frame') {
            updateData.equipped_frame = inventoryItem.image;
            logMsg = `สวมใส่กรอบรูป: ${itemName}`;
        } else if (inventoryItem.type === 'skin_bg') {
            updateData.equipped_bg = inventoryItem.image;
            logMsg = `เปลี่ยนพื้นหลังชื่อ: ${itemName}`;
        }

        // อัปเดตข้อมูลนักเรียน (โดยไม่ยุ่งกับ inventory)
        batch.update(sRef, updateData);

        // บันทึกประวัติ
        batch.set(hRef, {
            student_id: s.id,
            student_name: s.full_name,
            action: logMsg,
            amount: 0,
            type: 'equip_skin',
            timestamp: serverTimestamp()
        });

        await batch.commit();
        alert(`สวมใส่ "${itemName}" เรียบร้อย!`);
        
        // รีเฟรชหน้าจอ
        if(typeof renderStudentList === 'function') renderStudentList(false);
        if(typeof openAdminInventory === 'function') openAdminInventory(s.id); // รีเฟรชหน้ากระเป๋า (ถ้าเปิดอยู่)
        
        return; // 🛑 จบการทำงานทันที (ไม่ไปทำส่วนลบของด้านล่าง)
    }
    // ============================================================

    // ลบไอเทมเดิมออกก่อน (ใช้แล้วต้องหายไป)
    const newInventory = s.inventory.filter(i => (i.id || i.instance_id) !== itemId);
    batch.update(sRef, { inventory: newInventory });

    // 🔥 ตรวจสอบว่าเป็นคูปองบัฟหรือไม่?
    if (inventoryItem.type === 'buff_coupon' && inventoryItem.buff_config) {
        const config = inventoryItem.buff_config;
        const now = new Date();
        const endTime = new Date(now.getTime() + (config.duration_min * 60 * 1000));
        
        let updates = {};
        let logAction = "";

        // แปลง Type เป็น Field ใน Database
        if (config.target_stat === 'interest') {
            updates['buff_interest_val'] = config.val;  // ค่าบัฟ (เช่น 2.0)
            updates['buff_interest_end'] = endTime;     // เวลาหมดอายุ
            logAction = `ใช้คูปองดอกเบี้ย +${config.val}%`;
        } 
        else if (config.target_stat === 'discount') {
            updates['buff_discount_val'] = config.val;
            updates['buff_discount_end'] = endTime;
            logAction = `ใช้คูปองส่วนลด +${config.val}%`;
        }
        else if (config.target_stat === 'boost') {
            updates['buff_points_val'] = (config.val); 
            updates['buff_points_end'] = endTime;
            logAction = `ใช้คูปองบูสต์แต้ม +${config.val}%`;
        }

        // อัปเดตสถานะบัฟให้นักเรียน
        batch.update(sRef, updates);
        
        // บันทึกประวัติ
        batch.set(hRef, {
            student_id: s.id,
            student_name: s.full_name,
            action: logAction,
            amount: 0,
            type: 'use_buff_item',
            timestamp: serverTimestamp()
        });

        await batch.commit();
        showToast(`ใช้งาน ${inventoryItem.name} เรียบร้อย!`);
        document.getElementById('teacher-inventory-modal').classList.add('hidden');
        return; // จบการทำงาน
    }
    let logMsg = "";

   // 🔥🔥 [แก้ใหม่] เช็ค Gacha จากตัวไอเทมโดยตรง (ไม่ต้องพึ่งร้านค้า) 🔥🔥
   let pool = inventoryItem.gacha_pool;
    
    // Backward Compatibility: รองรับกล่องรุ่นเก่า (ที่ไม่มี pool ติดตัว) ให้ไปดึงจาก Shop เหมือนเดิม
    if (!pool) {
         const masterReward = rewards.find(r => r.id === inventoryItem.reward_id);
         if (masterReward && masterReward.type === 'gacha_custom') {
             pool = masterReward.gacha_pool;
         }
    }

    // ถ้ามี Pool (ไม่ว่าจะจากตัวมันเอง หรือจากร้าน) ถือว่าเป็น Gacha
    if (pool && pool.length > 0) {
        
        // ============================================================
        // 🔥 LOGIC ใหม่: คัดกรองของที่ "หมดสต็อก" หรือ "หายไป" ออกก่อนสุ่ม
        // ============================================================
        const validPool = pool.filter(slot => {
            // A. ถ้าไม่ใช่สิ่งของ (เช่น แต้ม, บัฟ, ข้อความ) -> เก็บไว้เสมอ (ถือว่าไม่มีวันหมด)
            if (slot.type !== 'reward_ref') return true;

            // B. ถ้าเป็นสิ่งของ -> เช็คสต็อกจริงเดี๋ยวนี้เลย
            const realItem = rewards.find(r => r.id === slot.reward_id);
            
            // ถ้าหาไม่เจอ หรือ ของหมด (stock = 0) -> ตัดทิ้ง! (return false)
            if (!realItem) return false;
            // เช็คสต็อก (ถ้าไม่ใช่ Unlimited (-1) และเหลือน้อยกว่า 1) -> หมด
            if (realItem.stock !== -1 && realItem.stock < 1) return false;

            // ถ้าของยังเหลือ -> เก็บไว้ (return true)
            return true;
        });

        // กรณีฉุกเฉิน: ของในกล่องหมดเกลี้ยงทุกชิ้น! (ไม่มีอะไรให้สุ่มเลย)
        if (validPool.length === 0) {
            const refund = 500; // แต้มชดเชย (ปรับได้)
            alert(`😭 เสียใจด้วยครับ ของรางวัลในกล่องนี้ "หมดเกลี้ยง" ทุกอย่างแล้ว\nระบบเปลี่ยนเป็นแต้มชดเชยให้ ${refund} แต้ม ครับ`);
            
            // คืนแต้มให้นักเรียน + บันทึกประวัติ
            batch.update(sRef, { points: increment(refund) });
            
            batch.set(hRef, {
                student_id: s.id,
                student_name: s.full_name,
                action: `เปิดกล่องเปล่า (ของหมด): ${itemName}`,
                amount: refund,
                type: 'gacha_refund',
                timestamp: serverTimestamp()
            });
            
            await batch.commit();
            showToast('ได้รับแต้มชดเชยเรียบร้อย');
            return; // จบการทำงาน
        }

        // --- โหมดเปิดกล่องสุ่ม (ใช้ Pool ที่คัดกรองแล้ว) ---
        logMsg = `เปิดกล่องสุ่ม: ${itemName}`;
        
        // คำนวณผลรวมโอกาสใหม่ (เพราะพอตัดของออก ยอดรวมอาจไม่ถึง 100%)
        const totalChance = validPool.reduce((sum, item) => sum + (item.chance || 0), 0);
        let roll = Math.random() * totalChance; // สุ่มจาก 0 ถึงยอดรวมใหม่
        let cumulative = 0;
        let wonSlot = null;
        
        // สุ่มจาก Pool ที่คัดกรองแล้ว (validPool)
        for (let slot of validPool) { 
            cumulative += slot.chance;
            if (roll < cumulative) { wonSlot = slot; break; }
        }
        // กันเหนียว (ถ้าหลุด Loop ให้เอาตัวสุดท้าย)
        if (!wonSlot && validPool.length > 0) wonSlot = validPool[validPool.length - 1];

        // Animation Setup
        const modal = document.getElementById('gacha-animation-modal');
        const iconEl = document.getElementById('gacha-anim-icon');
        const textEl = document.getElementById('gacha-anim-text');
        const subEl = document.getElementById('gacha-anim-sub');
        const btnEl = document.getElementById('gacha-close-btn');

        modal.classList.remove('hidden');
        iconEl.classList.add('animate-gacha-shake');
        textEl.textContent = "3";
        await new Promise(r => setTimeout(r, 800));
        textEl.textContent = "2"; await new Promise(r => setTimeout(r, 800));
        textEl.textContent = "1";
        await new Promise(r => setTimeout(r, 800));
        iconEl.classList.remove('animate-gacha-shake');
        iconEl.classList.add('animate-pop');
        
        let resultIcon = '💨';
        let resultTitle = 'เกลือ...';
        let resultSub = 'เสียใจด้วยนะ ไม่ได้อะไรเลย';

        if (wonSlot) {
            let newCard = { id: crypto.randomUUID(), acquired_at: Date.now() };

            if (wonSlot.type === 'points') {
                const pts = Math.floor(Math.random() * (wonSlot.max - wonSlot.min + 1)) + wonSlot.min;
                newCard.name = `คูปอง ${pts} แต้ม`;
                newCard.type = 'instant_points';
                newCard.value = pts;
                newCard.image = '💸';
                resultIcon = '💸';
                resultTitle = `ยินดีด้วย! ${pts} แต้ม`;
                resultSub = 'การ์ดแต้มถูกเก็บเข้ากระเป๋าแล้ว';

            }  else if (wonSlot.type === 'interest') {
                const hours_buff = wonSlot.hours;
                newCard.name = `บัตรดอกเบี้ยเทพ ${wonSlot.rate}% (${hours_buff} ชั่วโมง)`;
                newCard.type = 'instant_interest';
                newCard.rate = wonSlot.rate;
                newCard.hours = wonSlot.hours;
                newCard.image = '📈';
                resultIcon = '📈';
                resultTitle = `ดอกเบี้ย ${wonSlot.rate}% นาน ${hours_buff} ชั่วโมง!`;
                resultSub = 'ใช้เมื่อไหร่ ดอกเบี้ยพุ่งเมื่อนั้น!';
            }
            else if (wonSlot.type === 'text') {
                newCard.name = wonSlot.text;
                newCard.type = 'instant_text';
                newCard.image = '📜';
                resultIcon = '📜';
                resultTitle = wonSlot.text;
                resultSub = 'ไปบอกครูเพื่อรับรางวัลพิเศษได้เลย!';
            } 
            else if (wonSlot.type === 'reward_ref') {
                const subReward = rewards.find(r => r.id === wonSlot.reward_id);
                if (subReward) {
                    newCard.reward_id = subReward.id;
                    newCard.name = subReward.name;
                    newCard.image = subReward.image;
                    newCard.type = 'general_item';
                    resultIcon = subReward.image ? `<img src="${subReward.image}" class="w-full h-full object-contain">` : '🎁';
                    resultTitle = subReward.name;
                    resultSub = 'ได้รับไอเทมเข้ากระเป๋า';

                    // ✅ [เพิ่มส่วนนี้] สั่งตัดสต็อกจริงใน Database
                    if (subReward.stock !== -1) {
                        const rRef = doc(db, 'artifacts', appId, 'public', 'data', 'rewards', subReward.id);
                        batch.update(rRef, { stock: increment(-1) });
                    }
                }
            }
            // 🛠️ แก้ไขตรงนี้: ไม่ยัดเยียดบัฟ แต่ให้เป็นการ์ดแทน
            else if (wonSlot.type === 'buff_discount') {
                const discountVal = parseInt(wonSlot.value) || 10;
                const durationMinutes = parseInt(wonSlot.duration) || 60;
                
                newCard.name = `บัตรส่วนลด ${discountVal}% (${durationMinutes} ชั่วโมง)`;
                newCard.type = 'instant_buff'; // ใช้ Type นี้
                newCard.image = '🏷️';
                newCard.value = discountVal;      // เก็บค่า %
                newCard.duration = durationMinutes; // เก็บเวลา
                
                resultIcon = '🏷️';
                resultTitle = `ได้บัตรส่วนลด ${discountVal}%`;
                resultSub = `เก็บไว้ใช้ตอนจะซื้อของนะ (นาน ${durationMinutes} ชั่วโมง)`;
            }

            else if (wonSlot.type === 'buff_points') {
                    const val = parseInt(wonSlot.value) || 10;
                    const dur = parseInt(wonSlot.duration) || 24;
                    
                    newCard.name = `บัตรบูสต์แต้ม x${1 + (val/100)} (${dur} ชม.)`; // หรือเขียนว่า +% ก็ได้
                    newCard.type = 'instant_buff_points'; // ✨ Type ใหม่
                    newCard.image = '🚀';
                    newCard.value = val;
                    newCard.duration = dur;
                    
                    resultIcon = '🚀';
                    resultTitle = `ได้บัตรบูสต์แต้ม +${val}%`;
                    resultSub = `ใช้แล้วแต้มพุ่งกระฉูด! (นาน ${dur} ชม.)`;
                }
            else if (wonSlot.type === 'salt') {
                newCard.name = null;
                resultIcon = '🧂';
                resultTitle = wonSlot.text || 'เกลือเต็มๆ!';
                resultSub = 'เสียใจด้วยนะ รอบหน้าเอาใหม่';
                soundSalt.play();
            }
            else if (wonSlot.type === 'points_fix') {
                const pts = wonSlot.amount;
                newCard.name = `คูปอง ${pts} แต้ม`;
                newCard.type = 'instant_points'; // ใช้ Type เดิมของแต้มได้เลย
                newCard.value = pts;
                newCard.image = wonSlot.image ? wonSlot.image : '💎';
                resultIcon = '💎';
                resultTitle = `รับไปเลย! ${pts} แต้ม`;
                resultSub = 'การ์ดแต้มถูกเก็บเข้ากระเป๋าแล้ว';
            }

            if (newCard.name) {
                batch.update(sRef, { inventory: arrayUnion(newCard) });
                logMsg += ` -> ได้รับ ${newCard.name}`;
            }
        } else {
            logMsg += ` -> เกลือ`;
        }

        // แสดงผลลัพธ์
        if(wonSlot && wonSlot.type === 'reward_ref' && resultIcon.includes('<img')) {
            iconEl.innerHTML = resultIcon;
            iconEl.className = 'w-48 h-48 mb-6 inline-block drop-shadow-2xl animate-pop';
        } else {
            iconEl.textContent = resultIcon;
        }
        textEl.textContent = resultTitle;
        subEl.textContent = resultSub;
        btnEl.classList.remove('hidden');

        batch.set(hRef, {
            student_id: s.id,
            student_name: s.full_name,
            action: logMsg,
            amount: 0,
            type: 'use_item',
            timestamp: serverTimestamp()
        });
        await batch.commit();

    } else {
        // --- กรณีใช้การ์ดไอเทมปกติ (Manual Use) ---
        let alertMsg = "";
        
        if (inventoryItem.type === 'instant_points') {
            const pts = inventoryItem.value || 0;
           // 🔥 เพิ่ม Logic: เช็คใบเตือนก่อนแจกแต้ม
           if ((s.warning_cards || 0) > 0) {
            // ⛔ ถ้ามีใบเตือน -> เข้ากระเป๋าอายัด (Pending)
            batch.update(sRef, { pending_points: increment(pts) });
            
            logMsg = `ใช้การ์ดแต้ม: ${pts} คะแนน (ถูกอายัดจากใบเตือน)`;
            alertMsg = `⚠️ คุณมีใบเตือนค้างอยู่!\nแต้ม ${pts} คะแนน ถูกอายัดไว้ใน "แต้มรอตรวจสอบ" ชั่วคราวครับ`;
        } else {
            // ✅ ถ้าปกติ -> เข้ากระเป๋าหลักทันที
            batch.update(sRef, { points: increment(pts) });
            
            logMsg = `ใช้การ์ดแต้ม: ได้รับ ${pts} คะแนน`;
            alertMsg = `เพิ่ม ${pts} แต้มเรียบร้อย`;
        }
    }
        else if (inventoryItem.type === 'instant_red_card') {
            const amt = inventoryItem.value || 1;
            if (s.red_cards > 0) {
                const realReduce = Math.min(s.red_cards, amt);
                batch.update(sRef, { red_cards: increment(-realReduce) });
                logMsg = `ใช้การ์ดลบใบแดง: ลบไป ${realReduce} ใบ`;
                alertMsg = `ลบใบแดง ${realReduce} ใบเรียบร้อย`;
            } else {
                logMsg = `ใช้การ์ดลบใบแดง (แต่ไม่มีใบแดง)`;
                alertMsg = `นักเรียนไม่มีใบแดง ระบบบันทึกการใช้การ์ดแล้ว`;
            }
        }
        else if (inventoryItem.type === 'instant_interest') {
            const interest = Math.floor(calculatePendingInterest(s));
            const newPrincipal = (s.bank_points || 0) + interest;
            const endTime = new Date();
            endTime.setHours(endTime.getHours() + (inventoryItem.hours || 24));

            batch.update(sRef, { 
                bank_points: newPrincipal,
                bank_deposit_time: serverTimestamp(),
                special_interest_rate: inventoryItem.rate,
                special_interest_end: endTime
            });
            
            logMsg = `ใช้บัตรดอกเบี้ยเทพ: เรท ${inventoryItem.rate}% นาน ${inventoryItem.hours} ชม.`;
            alertMsg = `เริ่มใช้โปรโมชั่นดอกเบี้ย ${inventoryItem.rate}% เรียบร้อย!`;
        }
        // 🛠️ เพิ่ม: รองรับการกดใช้บัตรส่วนลด
        else if (inventoryItem.type === 'instant_buff') {
            const val = parseInt(inventoryItem.value) || 10;
            const dur = parseInt(inventoryItem.duration) || 1;
            
            const endTime = new Date(Date.now() + dur * 60 * 60 * 1000);
            
            batch.update(sRef, {
                buff_discount_val: val,
                buff_discount_end: endTime
            });
            
            logMsg = `ใช้บัตรส่วนลด: ลด ${val}% นาน ${dur} ชั่วโมง`;
            alertMsg = `เริ่มใช้ส่วนลด ${val}% เรียบร้อย! รีบไปช้อปเลย! (หมดเวลา: ${endTime.toLocaleDateString()} ${endTime.toLocaleTimeString()})`;
        }

        
        else if (inventoryItem.type === 'instant_buff_points') {
            const val = parseInt(inventoryItem.value) || 10;
            const dur = parseInt(inventoryItem.duration) || 1;
            
            const endTime = new Date(Date.now() + dur * 60 * 60 * 1000);
            
            batch.update(sRef, {
                buff_points_val: val,      // บันทึก %
                buff_points_end: endTime   // บันทึกเวลาหมดอายุ
            });
            
            logMsg = `ใช้บัตรบูสต์แต้ม: เพิ่ม ${val}% นาน ${dur} ชั่วโมง`;
            alertMsg = `🚀 เปิดใช้งานบูสต์แต้ม +${val}% เรียบร้อย! (หมดเวลา: ${endTime.toLocaleDateString()} ${endTime.toLocaleTimeString()})`;
        }

        

        else {
            logMsg = `ใช้งานไอเทม: ${itemName}`;
            alertMsg = `บันทึกการใช้งาน "${itemName}" แล้ว`;
        }

        batch.set(hRef, {
            student_id: s.id,
            student_name: s.full_name,
            action: logMsg,
            amount: 0,
            type: 'use_item',
            timestamp: serverTimestamp()
        });
        await batch.commit();
        
        document.getElementById('teacher-inventory-modal').classList.add('hidden');
        if(alertMsg) alert(alertMsg);
        showToast(logMsg);
    }
};

//ฟังก์ชันสำหรับจัดการกระเป๋าไอเท็มของครู
let currentInvStudent = null;

window.openTeacherInventory = (sid) => {
    currentInvStudent = students.find(s => s.id === sid);
    if(!currentInvStudent) return;

    document.getElementById('inv-student-name').textContent = currentInvStudent.full_name;
    renderTeacherInventory();
    document.getElementById('teacher-inventory-modal').classList.remove('hidden');
};

function renderTeacherInventory() {
    const container = document.getElementById('teacher-inventory-list');
    const items = currentInvStudent.inventory || [];
    
    if (items.length === 0) {
        container.innerHTML = '<p class="text-gray-400 col-span-full text-center py-10">นักเรียนคนนี้ไม่มีไอเทมในกระเป๋า</p>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="border border-indigo-100 rounded-xl p-4 flex flex-col items-center bg-indigo-50/50 hover:bg-white hover:shadow-md transition-all">
            <div class="text-5xl mb-3 h-12 flex items-center justify-center">
                ${item.image || '📦'}
            </div>
            <h4 class="font-bold text-sm text-center text-gray-800 mb-1">${item.name}</h4>
            <p class="text-xs text-gray-500 mb-3 text-center">${getItemTypeLabel(item)}</p>
            <button onclick="useItem('${item.id || item.instance_id}', '${item.name}')" 
                class="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm py-2 rounded-lg font-bold shadow-sm transition-colors flex items-center justify-center gap-2">
                <span>⚡</span> กดใช้
            </button>
        </div>
    `).join('');
}

function getItemTypeLabel(item) {
    if (item.type === 'gacha_box') return 'กล่องสุ่ม (ยังไม่เปิด)';
    if (item.type === 'instant_points') return `การ์ดแต้ม (${item.value})`;
    if (item.type === 'instant_red_card') return `การ์ดลบใบแดง (${item.value} ใบ)`;
    if (item.type === 'instant_text') return 'บัตรพิเศษ';
    return 'ไอเทมทั่วไป';
}

// --- REAL-TIME NOTIFICATION SYSTEM ---
window.showGameNotification = (type, message, amount) => {
    const container = document.getElementById('toast-container'); // ใช้ container เดียวกับ Toast เดิม แต่ปรับสไตล์
    const div = document.createElement('div');
    
    let bgColor = 'bg-gray-800';
    let icon = '🔔';
    let sound = null;

    if (type === 'add_points') {
        bgColor = 'bg-gradient-to-r from-green-500 to-emerald-600';
        icon = '💰';
        sound = soundCoin;
    } else if (type === 'remove_points' || type === 'red_card') {
        bgColor = 'bg-gradient-to-r from-red-500 to-orange-600';
        icon = '🚨';
        sound = soundWhistle;
    } else if (type === 'salt') {
         bgColor = 'bg-gray-500';
         icon = '🧂';
         sound = soundSalt;
    }

    // เล่นเสียง (ถ้ามี)
    if (sound) {
        sound.currentTime = 0;
        sound.play().catch(e => console.log('Audio play failed (need interaction first)'));
    }

    div.className = `transform translate-y-full opacity-0 transition-all duration-500 flex items-center gap-4 p-4 rounded-2xl shadow-2xl border-2 border-white/20 text-white min-w-[300px] mb-4 ${bgColor}`;
    div.innerHTML = `
        <div class="text-4xl animate-bounce">${icon}</div>
        <div>
            <h4 class="font-bold text-lg">${message}</h4>
            <p class="text-sm opacity-90 font-mono text-xl font-black">${amount > 0 ? '+' : ''}${amount}</p>
        </div>
    `;

    // แทรกไว้ล่างสุดของ Container (เพื่อให้มันกองขึ้นไป)
    // หมายเหตุ: ต้องแก้ CSS ของ #toast-container นิดนึงในข้อถัดไป
    container.appendChild(div);

    // Animation เข้า
    requestAnimationFrame(() => {
        div.classList.remove('translate-y-full', 'opacity-0');
    });

    // ค้างไว้ 6 วินาที แล้วหายไป
    setTimeout(() => {
        div.classList.add('translate-y-full', 'opacity-0');
        setTimeout(() => div.remove(), 500);
    }, 6000);
};

// --- 🏰 GUILD SYSTEM LOGIC ---

let guilds = [];

// 3. ฟังก์ชันหลัก
window.showCreateGuildModal = () => document.getElementById('create-guild-modal').classList.remove('hidden');

// ค้นหาและวางทับฟังก์ชันนี้ใน app.js ครับ
window.handleCreateGuild = async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-guild-name').value;
    const icon = document.getElementById('new-guild-icon').value || '🛡️';
    const cooldown = 0;
    const fee = 0;
    
    try {
        // ✅ 1. สร้างกิลด์และเก็บ Reference ไว้
        const docRef = await addDoc(collections.guilds(), {
            name: name,
            icon: icon,
            rule_cooldown: cooldown,
            rule_fee: fee,
            created_at: serverTimestamp()
        });

        // ปิดหน้าต่างสร้าง + เคลียร์ฟอร์ม
        document.getElementById('create-guild-modal').classList.add('hidden');
        e.target.reset();
        
        // ✅ 2. เพิ่มกิลด์ใหม่เข้าตัวแปรระบบทันที (Hack: เพื่อให้เปิดหน้าจัดการได้โดยไม่ต้องรอ Server Refresh)
        const newGuildLocal = {
            id: docRef.id,
            name: name,
            icon: icon,
            rule_cooldown: cooldown,
            rule_fee: fee,
            buff_interest: 0,
            buff_discount: 0
        };
        
        // เช็คกันเหนียว ถ้ายังไม่มีในลิสต์ ก็ยัดเข้าไปเลย
        if (!guilds.find(g => g.id === docRef.id)) {
            guilds.push(newGuildLocal);
        }

        showToast('สร้างกิลด์เรียบร้อย! กำลังเปิดหน้าจัดการสมาชิก...');

        // ✅ 3. สั่งเปิดหน้าจัดการสมาชิกของกิลด์ใหม่ทันที!
        setTimeout(() => {
            openManageGuild(docRef.id);
        }, 300); // หน่วงเวลานิดนึงให้ Animation ปิดหน้าต่างเก่าทำงานสมูทๆ

    } catch (err) {
        alert('Error: ' + err.message);
    }
};

// ==========================================
// 🏰 Render Guild Dashboard (Pagination ใหม่)
// ==========================================
window.renderGuildsDashboard = (resetPage = true) => {
    // 1. ตั้งค่า State
    if (!window.paginationState) window.paginationState = { guild: 1 };
    if (resetPage) window.paginationState.guild = 1;

    const board = document.getElementById('guild-leaderboard');
    const listBody = document.getElementById('guild-list-body');
    const searchInput = document.getElementById('guild-search-input');
    
    if (searchInput) {
         searchInput.placeholder = "ค้นหาชื่อกิลด์, สมาชิก, เลขประจำตัว หรือชั้นเรียน...";
    }
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    if(!board || !listBody) return;

    // 2. คำนวณ Stat และเตรียมข้อมูลสำหรับ Search Engine
    const guildStats = guilds.map(g => {
        const members = students.filter(s => s.guild_id === g.id);
        const totalPoints = members.reduce((sum, s) => sum + (s.points || 0), 0);
        
        // Search Context: รวมข้อมูลสมาชิกทั้งหมดเป็นก้อนเดียว
        const searchContext = members.map(s => 
            `${s.full_name} ${s.student_id || ''} ${s.class_name || ''}`
        ).join(' ').toLowerCase();
        
        return { 
            ...g, 
            memberCount: members.length, 
            totalPoints: totalPoints,
            fullSearchText: `${g.name.toLowerCase()} ${searchContext}`
        };
    });

    // 3. เรียงลำดับตามแต้มรวม (Top 3)
    guildStats.sort((a, b) => b.totalPoints - a.totalPoints);

    // 4. Render Top 3 Cards (แสดงเสมอ ไม่ขึ้นกับ Pagination)
    board.innerHTML = guildStats.slice(0, 3).map((g, index) => {
        const colors = [
            'bg-yellow-100 border-yellow-300 text-yellow-800',
            'bg-gray-100 border-gray-300 text-gray-600',
            'bg-orange-100 border-orange-300 text-orange-800'
        ];
        const medals = ['🥇', '🥈', '🥉'];
        const buffs = getGuildActiveBuffs(g.id);
        let buffText = '';
        
        if(buffs.interest > 0) buffText += `<div>📈 ดอกเบี้ย +${parseFloat(buffs.interest).toFixed(2)}%</div>`;
        if(buffs.discount > 0) buffText += `<div>🏷️ ส่วนลด ${buffs.discount}%</div>`;
        if(buffs.point_boost > 0) buffText += `<div>🚀 แต้ม +${buffs.point_boost}%</div>`;
        
        return `
        <div class="relative p-6 rounded-2xl border-2 shadow-sm flex flex-col items-center ${colors[index]}">
            <div class="absolute -top-4 bg-white p-2 rounded-full shadow-md text-2xl">${medals[index]}</div>
            <div class="text-6xl mb-2 mt-2 transform hover:scale-110 transition-transform cursor-default">${g.icon}</div>
            <h3 class="text-xl font-bold mb-1">${g.name}</h3>
            <p class="text-3xl font-black mb-2">${Math.floor(g.totalPoints).toLocaleString()}</p>
            <div class="text-[10px] font-bold bg-white/60 rounded-lg px-2 py-1 space-y-0.5 w-full text-center">
                ${buffText || '- ไม่มีบัฟ -'}
            </div>
        </div>`;
    }).join('');

    // 5. กรองข้อมูล (Search)
    const filteredGuilds = guildStats.filter(g => g.fullSearchText.includes(searchTerm));

    // ==========================================
    // 🔥 แก้ไข Logic Pagination (Global)
    // ==========================================
    const perPage = window.itemsPerPage || 10;
    const totalItems = filteredGuilds.length;
    const totalPages = Math.ceil(totalItems / perPage) || 1;

    // ป้องกันเลขหน้าเกินจริง
    if (window.paginationState.guild > totalPages) window.paginationState.guild = totalPages;
    if (window.paginationState.guild < 1) window.paginationState.guild = 1;

    const currentPage = window.paginationState.guild;
    const startIndex = (currentPage - 1) * perPage;
    
    // ตัดข้อมูล
    const paginatedData = filteredGuilds.slice(startIndex, startIndex + perPage);

    // ==========================================

    // 6. Render List Table
    if (paginatedData.length === 0) {
        listBody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-400">ไม่พบกิลด์ที่ค้นหา</td></tr>`;
    } else {
        listBody.innerHTML = paginatedData.map(g => {
            // หาอันดับจริงจากข้อมูลทั้งหมด (ไม่ใช่ข้อมูลที่ตัดหน้ามา)
            const realRank = guildStats.findIndex(x => x.id === g.id) + 1;
            const buffs = getGuildActiveBuffs(g.id);
            let buffBadges = '';
            if(buffs.interest > 0) buffBadges += `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700 border border-green-200">📈 +${parseFloat(buffs.interest).toFixed(2)}%</span> `;
            if(buffs.discount > 0) buffBadges += `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">🏷️ -${buffs.discount}%</span> `;
            if(buffs.point_boost > 0) buffBadges += `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">🚀 +${buffs.point_boost}%</span>`;

            return `
            <tr class="hover:bg-indigo-50 cursor-pointer transition-colors group" onclick="openManageGuild('${g.id}')">
                <td class="px-6 py-4 text-center font-bold text-gray-500">#${realRank}</td>
                <td class="px-6 py-4 font-medium text-indigo-900">
                    <div class="flex items-center gap-3">
                        <span class="text-2xl">${g.icon}</span> 
                        <div class="flex flex-col items-start gap-1">
                            <span>${g.name}</span>
                            <div class="flex flex-wrap gap-1">${buffBadges}</div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 text-center text-gray-600">${g.memberCount}</td>
                <td class="px-4 py-3 text-center font-mono font-bold text-amber-600">${(g.fund_points || 0).toLocaleString()}</td>
                <td class="px-6 py-4 text-center font-bold text-gray-800 group-hover:text-indigo-600">${Math.floor(g.totalPoints).toLocaleString()}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex items-center justify-center gap-2">
                
                        <button onclick="event.stopPropagation(); openGuildStore('${g.id}')" 
                        class="p-2 text-amber-600 hover:bg-amber-100 rounded-full transition" 
                        title="เข้าร้านค้ากิลด์">
                        🏪
                        </button>
                        
                        <button class="text-indigo-600 hover:bg-indigo-100 p-2 rounded-full">
                        ⚙️ จัดการ
                        </button>
                    </div>
                </td>
            </tr>
            `}).join('');
    }

    // 🔥 7. Render Pagination Controls (ใช้ปุ่มแบบใหม่)
    // ตรงนี้สำคัญ: HTML ID ต้องเป็น 'pagination-guild' เพื่อให้ตรงกับ type 'guild' ที่เราใช้ใน state
    if (typeof renderPaginationControls === 'function') {
        const paginationContainer = document.getElementById('pagination-guild'); // ID ใน HTML
        if (paginationContainer) {
            paginationContainer.innerHTML = renderPaginationControls(totalItems, 'guild'); // ส่ง type 'guild'
        }
    }
};


let currentManageGuildId = null;

window.openManageGuild = (gid) => {
    currentManageGuildId = gid;
    const g = guilds.find(x => x.id === gid);
    if(!g) return;

    const nameInput = document.getElementById('edit-guild-name');
    const iconInput = document.getElementById('edit-guild-icon');
    if(nameInput) nameInput.value = g.name;
    if(iconInput) iconInput.value = g.icon;
    
    document.getElementById('manage-guild-id').value = gid;
    
    const liveBuffs = getGuildActiveBuffs(gid); 
    
    document.getElementById('guild-buff-interest').value = (liveBuffs.interest || 0).toFixed(2);
    document.getElementById('guild-buff-discount').value = liveBuffs.discount || 0;

    if(document.getElementById('edit-guild-cooldown')) {
    document.getElementById('edit-guild-cooldown').value = g.rule_cooldown || 0;
    document.getElementById('edit-guild-fee').value = g.rule_fee || 0;
}

    

    // 🧠 1. รีเซ็ตและจำค่าสมาชิกเดิมก่อนเริ่มแก้ไข
    tempGuildSelection.clear();
    students.forEach(s => {
        if (s.guild_id === gid) tempGuildSelection.add(s.id);
    });

    // เคลียร์ช่องค้นหาและแสดงผล
    document.getElementById('search-student-guild').value = '';
    renderGuildMembersSelect();
    document.getElementById('manage-guild-modal').classList.remove('hidden');
};

window.renderGuildMembersSelect = () => {
    const container = document.getElementById('guild-member-selection');
    const search = document.getElementById('search-student-guild').value.toLowerCase().trim();
    
    // 1. กรองข้อมูล
    let filtered = students.filter(s => 
        s.full_name.toLowerCase().includes(search) || 
        s.student_id.includes(search) ||
        (s.class_name && s.class_name.toLowerCase().includes(search))
    );
    
    // 2. เรียงลำดับ (Selected -> Room -> Name)
    filtered.sort((a, b) => {
        const aSelected = tempGuildSelection.has(a.id);
        const bSelected = tempGuildSelection.has(b.id);
        if (aSelected !== bSelected) return bSelected - aSelected; 

        const classA = a.class_name || "";
        const classB = b.class_name || "";
        if (classA !== classB) return classA.localeCompare(classB, 'th');

        return a.full_name.localeCompare(b.full_name, 'th');
    });
    
    // 3. วาดลงหน้าจอ
    let currentClass = null;
    let html = '';
    
    // 🕒 เตรียมตัวแปรคำนวณ Cooldown [NEW]
    // 1. หาข้อมูลกิลด์ที่กำลังจัดการอยู่
    const editingGuild = guilds.find(g => g.id === currentManageGuildId);

// 2. ดึงค่า Cooldown จากกิลด์นั้น (ถ้าไม่มีให้เป็น 0)
    const ruleCooldown = editingGuild ? (parseInt(editingGuild.rule_cooldown) || 0) : 0;
    const now = Date.now();
    const cooldownMs = ruleCooldown * 60 * 60 * 1000;
    
    filtered.forEach(s => {
        const isSelected = tempGuildSelection.has(s.id);
        const sClass = s.class_name || "ไม่ระบุห้อง";
        
        let groupHeader = isSelected ? "🌟 สมาชิกที่เลือกไว้ / อยู่ในกิลด์" : `📍 ห้อง ${sClass}`;

        if (groupHeader !== currentClass) {
            currentClass = groupHeader;
            html += `<div class="col-span-full mt-4 mb-2 px-4 py-2 text-sm font-bold text-gray-700 bg-gray-100 rounded-lg sticky top-0 z-10 shadow-sm border-l-4 ${isSelected ? 'border-green-500 bg-green-50' : 'border-indigo-400'}">
                        ${currentClass}
                     </div>`;
        }

        // ข้อมูลเสริม
        const isInThisGuild = s.guild_id === currentManageGuildId;
        const hasOtherGuild = s.guild_id && !isInThisGuild;
        const guildName = hasOtherGuild ? (guilds.find(g => g.id === s.guild_id)?.name || 'Unknown') : '';

        // ⏳ คำนวณเวลาที่เหลือ (Cooldown Badge) [NEW]
        let cooldownBadge = '';
        if (ruleCooldown > 0 && s.guild_id === currentManageGuildId) {
             let joinedTime = 0;
             // แปลงเวลาให้ชัวร์
             if (s.guild_joined_at) {
                if (typeof s.guild_joined_at.toMillis === 'function') joinedTime = s.guild_joined_at.toMillis();
                else if (s.guild_joined_at instanceof Date) joinedTime = s.guild_joined_at.getTime();
                else if (s.guild_joined_at.seconds) joinedTime = s.guild_joined_at.seconds * 1000;
             }

             if (joinedTime > 0) {
                 const timeDiff = now - joinedTime;
                 if (timeDiff < cooldownMs) {
                     const remainingHrs = Math.ceil((cooldownMs - timeDiff) / (1000 * 60 * 60));
                     // สร้างป้ายเตือน
                     cooldownBadge = `<div class="mt-1"><span class="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded border border-amber-200 inline-block font-bold">⏳ สัญญาเหลือ ${remainingHrs} ชม.</span></div>`;
                 }
             }
        }

        // ไฮไลท์สี
        const activeClass = isSelected 
            ? 'bg-green-50 border-green-500 ring-2 ring-green-200 shadow-md' 
            : 'hover:bg-gray-50 border-gray-200';

        html += `
        <label class="flex items-start p-3 border rounded-lg cursor-pointer transition-all ${activeClass}">
            <div class="flex items-start gap-3 w-full overflow-hidden">
                <input type="checkbox" class="guild-member-check w-5 h-5 mt-1 rounded text-green-600 focus:ring-green-500 shrink-0" 
                       value="${s.id}" ${isSelected ? 'checked' : ''} onchange="toggleGuildSelection('${s.id}')">
                
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-gray-800 text-sm truncate leading-tight mb-1">
                        ${s.full_name}
                    </p>
                    <p class="text-xs text-gray-500 flex items-center gap-1 mb-1">
                        <span class="bg-gray-200 px-1.5 rounded text-[10px] min-w-[20px] text-center">${s.student_id}</span>
                        <span class="text-gray-400">|</span>
                        <span>ห้อง ${s.class_name}</span>
                    </p>
                    
                    ${hasOtherGuild ? 
                        `<div class="mt-1">
                            <span class="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded border border-red-200 inline-block font-bold">
                                ⚠️ ย้ายจาก: ${guildName}
                            </span>
                        </div>` : ''
                    }
                    
                    ${cooldownBadge} </div>
            </div>
        </label>`;
    });

    if (filtered.length === 0) {
        html = `<div class="col-span-full text-center py-10 text-gray-400">ไม่พบนักเรียนที่ค้นหา</div>`;
    }

    container.innerHTML = html;
};

// ฟังก์ชันช่วย: จำค่าเมื่อติ๊กถูก/เอาออก
window.toggleGuildSelection = (id) => {
    if (tempGuildSelection.has(id)) {
        tempGuildSelection.delete(id);
    } else {
        tempGuildSelection.add(id);
    }
    renderGuildMembersSelect(); // รีเฟรชหน้าจอ (เพื่ออัปเดตสีพื้นหลัง)
};

// ==========================================
// ฟังก์ชันบันทึกข้อมูลกิลด์
// ==========================================

window.showGuildPenaltyModal = (type, dataList, feePerPerson, totalFee) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('guild-penalty-modal');
        
        // ถ้าหา Modal ไม่เจอ ให้ใช้ confirm แบบเดิมแก้ขัดไปก่อน
        if (!modal) {
            console.warn('หา Modal ไม่เจอ ใช้ confirm ธรรมดาแทน');
            const msg = type === 'lock' 
                ? `⛔ ติดสัญญากิลด์!\n${dataList.map(l => l.name).join(', ')}` 
                : `⚠️ ยืนยันจ่ายค่าปรับรวม ${totalFee} แต้ม?`;
            
            if (type === 'lock') { alert(msg); resolve(false); }
            else { resolve(confirm(msg)); }
            return;
        }

        // Setup Elements
        const headerBar = document.getElementById('gp-header-bar');
        const iconBg = document.getElementById('gp-icon-bg');
        const icon = document.getElementById('gp-icon');
        const title = document.getElementById('gp-title');
        const subtitle = document.getElementById('gp-subtitle');
        const list = document.getElementById('gp-list');
        const totalSection = document.getElementById('gp-total-section');
        const totalAmount = document.getElementById('gp-total-amount');
        const actions = document.getElementById('gp-actions');
        const footer = document.getElementById('gp-footer-text');

        // Reset List
        list.innerHTML = '';
        dataList.forEach(item => {
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center border-b border-gray-200 pb-1 last:border-0 last:pb-0';
            if (type === 'lock') {
                li.innerHTML = `<div class="flex flex-col"><span class="font-bold text-gray-700 text-xs">${item.name}</span><span class="text-[10px] text-gray-400">เหลือสัญญา ${item.hours} ชม.</span></div><span class="text-xs font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">ขาด ${item.missing}</span>`;
            } else {
                li.innerHTML = `<span class="font-bold text-gray-700 text-xs">${item.name}</span><span class="text-xs font-bold text-orange-500">-${feePerPerson}</span>`;
            }
            list.appendChild(li);
        });

        // Config UI
        if (type === 'lock') {
            headerBar.className = "h-2 w-full bg-red-500";
            iconBg.className = "w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl shadow-inner bg-red-50 text-red-500";
            icon.innerHTML = '🛑';
            title.textContent = "ติดสัญญากิลด์!";
            title.className = "text-xl font-black text-red-600 mb-1";
            subtitle.textContent = "แต้มไม่พอจ่ายค่าปรับ ไม่สามารถย้ายได้";
            totalSection.classList.add('hidden');
            footer.textContent = "ต้องอยู่ครบสัญญา หรือเติมแต้มก่อน";
            
            // ปุ่ม Close (type="button")
            actions.innerHTML = `<button type="button" id="gp-btn-close" class="w-full py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-bold transition-colors">เข้าใจแล้ว</button>`;
            
            document.getElementById('gp-btn-close').onclick = () => {
                modal.classList.add('hidden');
                resolve(false); // ❌ ตอบกลับว่า "ไม่ผ่าน"
            };

        } else {
            headerBar.className = "h-2 w-full bg-orange-500";
            iconBg.className = "w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl shadow-inner bg-orange-50 text-orange-500";
            icon.innerHTML = '💸';
            title.textContent = "ยืนยันฉีกสัญญา";
            title.className = "text-xl font-black text-gray-800 mb-1";
            subtitle.textContent = `มีสมาชิก ${dataList.length} คน ต้องจ่ายค่าปรับ`;
            totalSection.classList.remove('hidden');
            totalAmount.textContent = totalFee.toLocaleString();
            footer.textContent = "⚠️ การตัดสินใจถือเป็นที่สิ้นสุด";

            // ปุ่ม Cancel & Confirm (type="button")
            actions.innerHTML = `
                <button type="button" id="gp-btn-cancel" class="flex-1 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-xl font-bold transition-colors">ยกเลิก</button>
                <button type="button" id="gp-btn-confirm" class="flex-1 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-bold shadow-lg transition-transform active:scale-95">ยอมจ่าย</button>
            `;

            document.getElementById('gp-btn-cancel').onclick = () => {
                console.log('User Clicked Cancel');
                modal.classList.add('hidden');
                resolve(false); // ❌ ตอบกลับว่า "ยกเลิก"
            };
            document.getElementById('gp-btn-confirm').onclick = () => {
                console.log('User Clicked Confirm');
                modal.classList.add('hidden');
                resolve(true); // ✅ ตอบกลับว่า "ตกลง"
            };
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    });
};

// ==========================================
// ฟังก์ชันบันทึกกิลด์ (Strict Check 🛡️)
// ==========================================
window.saveGuildData = async () => {
    if (!currentManageGuildId) return;

    // 1. รับค่า Config
    const newName = document.getElementById('edit-guild-name').value.trim();
    const newIcon = document.getElementById('edit-guild-icon').value.trim();
    const buffInterest = parseFloat(document.getElementById('guild-buff-interest').value) || 0;
    const buffDiscount = parseInt(document.getElementById('guild-buff-discount').value) || 0;
    const ruleCooldown = parseInt(document.getElementById('edit-guild-cooldown').value) || 0;
    const ruleFee = parseInt(document.getElementById('edit-guild-fee').value) || 0;

    const maxLimit = (typeof config !== 'undefined' && config.max_guild_members) ? parseInt(config.max_guild_members) : 0;
    if (maxLimit > 0 && tempGuildSelection.size > maxLimit) {
        return Swal.fire('สมาชิกเกิน', `กิลด์รับได้สูงสุด ${maxLimit} คน`, 'warning');
    }

    try {
        showLoading(true);

        const currentMembers = students.filter(s => s.guild_id === currentManageGuildId);
        const newMemberIds = Array.from(tempGuildSelection);
        const joiners = newMemberIds.map(id => students.find(s => s.id === id)).filter(s => s && !currentMembers.find(m => m.id === s.id));
        const leavers = currentMembers.filter(m => !newMemberIds.includes(m.id));

        // --- 🛡️ ส่วนตรวจสอบสัญญา (แก้ไข Logic) ---
        const lockedList = [];
        const penaltyList = [];
        let penaltyTotal = 0;
        const now = Date.now();
        const cooldownMs = ruleCooldown * 60 * 60 * 1000;
        
        const parseTime = (t) => {
            if (!t) return 0;
            if (typeof t.toMillis === 'function') return t.toMillis();
            if (t instanceof Date) return t.getTime();
            if (t.seconds) return t.seconds * 1000;
            return new Date(t).getTime();
        };

        const checkContract = (s) => {
            if (ruleCooldown <= 0) return;
            
            // 🔥 FIX: เช็คเฉพาะคนที่ "อยู่กิลด์นี้" เท่านั้น (คนนอกที่กำลังจะเข้า ไม่เกี่ยว)
            if (s.guild_id !== currentManageGuildId) return;

            const joinedTime = parseTime(s.guild_joined_at);
            const timeDiff = now - joinedTime;
            
            if (joinedTime > 0 && timeDiff < cooldownMs) {
                // ดึงแต้มปัจจุบัน (รองรับทั้ง points และ bank_points แบบคร่าวๆ เพื่อเช็ค)
                const currentPoints = s.points || 0;
                
                if (currentPoints < ruleFee) {
                    lockedList.push({ 
                        name: s.full_name, 
                        missing: (ruleFee - currentPoints).toLocaleString(), 
                        hours: Math.ceil((cooldownMs - timeDiff) / 3600000) 
                    });
                } else {
                    penaltyList.push({ name: s.full_name, id: s.id }); 
                    penaltyTotal += ruleFee; 
                }
            }
        };
        
        // ตรวจเฉพาะคนที่จะ "ออก" (Leavers)
        leavers.forEach(s => checkContract(s));

        if (lockedList.length > 0) { showLoading(false); await showGuildPenaltyModal('lock', lockedList); return; }
        if (penaltyList.length > 0) {
            showLoading(false);
            const confirmed = await showGuildPenaltyModal('confirm', penaltyList, ruleFee, penaltyTotal);
            if (confirmed !== true) return;
            showLoading(true);
        }
        // ----------------------------------

        const batch = writeBatch(db);
        const guildRef = doc(db, 'artifacts', appId, 'public', 'data', 'guilds', currentManageGuildId);
        
        batch.set(guildRef, {
            name: newName, icon: newIcon, rule_cooldown: ruleCooldown, rule_fee: ruleFee,
            buff_interest: buffInterest, buff_discount: buffDiscount
        }, { merge: true });

        // 🟢 1. จัดการคนเข้า (Joiners)
        joiners.forEach(s => {
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
            const updates = {
                guild_id: currentManageGuildId,
                guild_joined_at: new Date(),
            
            };

            if (penaltyList.find(p => p.id === s.id)) {
                updates.points = increment(-ruleFee);
                const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
                batch.set(hRef, { student_id: s.id, student_name: s.full_name, action: 'ค่าปรับ (ย้ายเข้า)', amount: -ruleFee, type: 'penalty', timestamp: serverTimestamp() });
            }
            batch.set(sRef, updates, { merge: true });
        });

        // 🔴 2. จัดการคนออก (Leavers)
        leavers.forEach(s => {
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
            
            const updates = {
                guild_id: null,
                guild_joined_at: null,
            };

            if (penaltyList.find(p => p.id === s.id)) {
                updates.points = increment(-ruleFee);
                const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
                batch.set(hRef, { student_id: s.id, student_name: s.full_name, action: 'ค่าปรับ (ลาออก)', amount: -ruleFee, type: 'penalty', timestamp: serverTimestamp() });
            }
            batch.set(sRef, updates, { merge: true });
        });

        await batch.commit();
        showLoading(false);
        document.getElementById('manage-guild-modal').classList.add('hidden');
        showToast(`💾 บันทึกและเคลียร์ยอดเรียบร้อย!`, 'success');

        if (typeof renderGuildsDashboard === 'function') renderGuildsDashboard();
        if (typeof renderStudentList === 'function') renderStudentList(false);

    } catch (err) {
        showLoading(false);
        console.error(err);
        Swal.fire('Error', err.message, 'error');
    }
};
// วางฟังก์ชันนี้ไว้ท้ายสุดของ Script 
// ==========================================
// ฟังก์ชันลบกิลด์ (Safe Mode: ล็อก 2 ชั้น 🔒)
// ==========================================
window.deleteGuild = async () => {
    if(!currentManageGuildId) return;

    // 1. เช็คจำนวนสมาชิก
    const members = students.filter(s => s.guild_id === currentManageGuildId);
    
    if (members.length > 0) {
        // 🛑 กรณีที่ 1: มีสมาชิกอยู่ -> แจ้งเตือนและจบการทำงานทันที!
        alert(`⚠️ ไม่สามารถลบกิลด์ได้!\n\nยังมีสมาชิกอยู่ ${members.length} คน\nต้องเคลียร์คนออกให้หมดก่อนลบกิลด์ครับ`);
        return; // หยุดตรงนี้แน่นอน ไม่ไหลลงไปข้างล่าง
    } else {
        // ✅ กรณีที่ 2: กิลด์ว่างเปล่า -> ถึงจะยอมให้ลบ
        if(!confirm('ยืนยันลบกิลด์นี้ถาวร?')) return;
        
        try {
            // ลบเอกสารกิลด์
            const guildRef = doc(db, 'artifacts', appId, 'public', 'data', 'guilds', currentManageGuildId);
            await deleteDoc(guildRef);

            // ปิดหน้าต่างและแจ้งเตือน
            document.getElementById('manage-guild-modal').classList.add('hidden');
            showToast('🗑️ ลบกิลด์เรียบร้อย');
            
        } catch (e) {
            console.error(e);
            alert('เกิดข้อผิดพลาด: ' + e.message);
        }
    }
};
// --- 🤖 AUTO GUILD BUFF SYSTEM ---

// ตั้งกติกาบัฟตรงนี้ (แก้ไขตัวเลขได้ตามใจชอบ)
const BUFF_RULES = {
    // กฎที่ 1: "เศรษฐี" (แต้มรวมกิลด์ถึงกำหนด -> ได้ดอกเบี้ยเพิ่ม)
    WEALTHY_TIER_1: { min_points: 5000, interest_bonus: 0.2 },
    WEALTHY_TIER_2: { min_points: 10000, interest_bonus: 0.5 },
    
    // กฎที่ 2: "เด็กดี" (ไม่มีใบแดงเลยทั้งกิลด์ -> ได้ส่วนลดร้านค้า)
    GOOD_BOY: { discount: 5 }, // ลด 5%

    // กฎที่ 3: "จ่าฝูง" (ติดอันดับ 1-3 -> ได้ดอกเบี้ยเพิ่มอีก)
    TOP_3_RANK: { interest_bonus: 0.3 }
};

// ฟังก์ชันคำนวณและบันทึกบัฟลง Database (ฉบับอัปเกรด: ใช้สูตรใหม่)
window.calculateAndApplyAutoBuffs = async () => {
    if (!auth.currentUser || userRole !== 'teacher') return;
    
    showToast("🤖 กำลังคำนวณบัฟกิลด์ (ระบบใหม่)...");
    
    const batch = writeBatch(db);
    let updateCount = 0;

    // วนลูปทุกกิลด์ในระบบ
    guilds.forEach(g => {
        // ✨ เรียกใช้สูตรคำนวณใหม่ (getGuildActiveBuffs) ที่เราเพิ่งทำ
        // เพื่อให้ได้ค่าตามตาราง Tier, Rank, และ Good Guild จริงๆ
        const buffs = getGuildActiveBuffs(g.id);

        // ค่าใหม่ที่จะบันทึก
        const newInterest = parseFloat(buffs.interest || 0);
        const newDiscount = parseInt(buffs.discount || 0);
        
        // เปรียบเทียบกับค่าเดิมใน DB (เพื่อดูว่ามีการเปลี่ยนแปลงไหม)
        const currentInt = parseFloat(g.buff_interest || 0);
        const currentDisc = parseInt(g.buff_discount || 0);

        // ถ้าค่าไม่ตรงกัน หรือยังไม่มีค่า -> สั่งอัปเดตลง DB
        // (การอัปเดตลง DB จำเป็นมาก เพราะระบบธนาคารและร้านค้าจะดึงค่าจาก DB ไปใช้)
        if (currentInt !== newInterest || currentDisc !== newDiscount) {
            const gRef = doc(db, 'artifacts', appId, 'public', 'data', 'guilds', g.id);
            
            batch.update(gRef, {
                buff_interest: newInterest,
                buff_discount: newDiscount,
                last_buff_calc: serverTimestamp() // แปะเวลาไว้ดูเล่นว่าคำนวณเมื่อไหร่
            });
            
            updateCount++;
            console.log(`Updated Guild ${g.name}: Interest ${currentInt}->${newInterest}, Disc ${currentDisc}->${newDiscount}`);
        }
    });

    // ส่งคำสั่งอัปเดตทั้งหมดทีเดียว
    if (updateCount > 0) {
        try {
            await batch.commit();
            showToast(`✅ อัปเดตบัฟสำเร็จ! (เปลี่ยนแปลง ${updateCount} กิลด์)`);
        } catch (e) {
            console.error(e);
            alert('เกิดข้อผิดพลาดในการบันทึก: ' + e.message);
        }
    } else {
        showToast("✅ ข้อมูลบัฟเป็นปัจจุบันอยู่แล้ว");
    }
};

// --- ⚙️ DYNAMIC RULES SYSTEM ---

// ค่าเริ่มต้น (เผื่อในฐานข้อมูลยังไม่มี)
let activeBuffRules = {
    w1_min: 5000, w1_bonus: 0.2,
    w2_min: 10000, w2_bonus: 0.5,
    good_discount: 5,
    top_bonus: 0.3
};

// 1. ฟังก์ชันโหลดค่าจาก DB มาใส่ใน Input (เรียกตอนเปิดแอป)
async function loadBuffRulesConfig() {
    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'buff_rules');
        const snap = await getDoc(docRef);
        
        if (snap.exists()) {
            activeBuffRules = { ...activeBuffRules, ...snap.data() };
        }
        
        // เอาค่าใส่ช่อง Input
        document.getElementById('rule-w1-min').value = activeBuffRules.w1_min;
        document.getElementById('rule-w1-bonus').value = activeBuffRules.w1_bonus;
        document.getElementById('rule-w2-min').value = activeBuffRules.w2_min;
        document.getElementById('rule-w2-bonus').value = activeBuffRules.w2_bonus;
        document.getElementById('rule-good-discount').value = activeBuffRules.good_discount;
        document.getElementById('rule-top-bonus').value = activeBuffRules.top_bonus;

    } catch (e) {
        console.log("ใช้กติกาเริ่มต้น", e);
    }
}

// 2. ฟังก์ชันบันทึกค่าจาก Input ลง DB
// ฟังก์ชันสร้างหน้าจอตั้งค่า (เรียกตอนเปิดหน้า Settings)
window.renderBuffRulesSettings = () => {
    const container = document.getElementById('buff-rules-container');
    if(!container) return;
    
    const rules = config.buff_rules || {};
    const tiers = rules.wealth_tiers || [];
    const ranks = rules.rank_rules || {};

    let html = `
    <div class="bg-yellow-50 p-4 rounded-xl border border-yellow-200">
        <h3 class="font-bold text-yellow-800 mb-3 flex items-center gap-2">💰 กฎเศรษฐี (Wealth Tiers)</h3>
        <table class="w-full text-sm">
            <thead>
                <tr class="text-left text-gray-500">
                    <th class="pb-2">แต้มขั้นต่ำ</th>
                    <th class="pb-2 text-center">ดอกเบี้ย+</th>
                    <th class="pb-2 text-center">ส่วนลด%</th>
                    <th class="pb-2 text-center">แต้ม+ (Boost)</th>
                </tr>
            </thead>
            <tbody id="wealth-rows">`;
    
    // สร้าง 5 แถวคงที่ (ว่างๆ ก็ได้)
    for(let i=0; i<5; i++) {
        const t = tiers[i] || {};
        html += `
        <tr>
            <td class="p-1"><input type="number" class="w-full border rounded px-2 py-1 wealth-min" value="${t.min || ''}" placeholder="-"></td>
            <td class="p-1"><input type="number" step="0.01" class="w-full border rounded px-2 py-1 text-center wealth-int" value="${t.interest || ''}" placeholder="0"></td>
            <td class="p-1"><input type="number" class="w-full border rounded px-2 py-1 text-center wealth-disc" value="${t.discount || ''}" placeholder="0"></td>
            <td class="p-1"><input type="number" class="w-full border rounded px-2 py-1 text-center wealth-boost" value="${t.boost || ''}" placeholder="0"></td>
        </tr>`;
    }

    html += `</tbody></table>
        <p class="text-[10px] text-yellow-600 mt-2">* ใส่แต้มขั้นต่ำเพื่อเปิดใช้งาน Tier นั้น (ระบบจะเลือก Tier สูงสุดที่ถึงเกณฑ์)</p>
    </div>

    <div class="bg-orange-50 p-4 rounded-xl border border-orange-200">
        <h3 class="font-bold text-orange-800 mb-3 flex items-center gap-2">👑 กฎจ่าฝูง (Top Guilds)</h3>
        <table class="w-full text-sm">
            <thead>
                <tr class="text-left text-gray-500">
                    <th class="pb-2 w-20">อันดับ</th>
                    <th class="pb-2 text-center">ดอกเบี้ย+</th>
                    <th class="pb-2 text-center">ส่วนลด%</th>
                    <th class="pb-2 text-center">แต้ม+ (Boost)</th>
                </tr>
            </thead>
            <tbody>`;
    
    [1, 2, 3].forEach(r => {
        const rb = ranks[r] || {};
        const medals = ['🥇', '🥈', '🥉'];
        html += `
        <tr>
            <td class="p-2 font-bold flex items-center gap-2">${medals[r-1]} ที่ ${r}</td>
            <td class="p-1"><input type="number" step="0.01" class="w-full border rounded px-2 py-1 text-center rank-int-${r}" value="${rb.interest || ''}" placeholder="0"></td>
            <td class="p-1"><input type="number" class="w-full border rounded px-2 py-1 text-center rank-disc-${r}" value="${rb.discount || ''}" placeholder="0"></td>
            <td class="p-1"><input type="number" class="w-full border rounded px-2 py-1 text-center rank-boost-${r}" value="${rb.boost || ''}" placeholder="0"></td>
        </tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
    
    // Load Good Student Rule
    document.getElementById('rule-good-discount').value = rules.good_discount || 0;
};

// บันทึก Config ใหม่
window.saveBuffRulesConfig = async () => {
    try {
        // 1. เก็บค่า Wealth Tiers
        const wealthTiers = [];
        const wMins = document.querySelectorAll('.wealth-min');
        const wInts = document.querySelectorAll('.wealth-int');
        const wDiscs = document.querySelectorAll('.wealth-disc');
        const wBoosts = document.querySelectorAll('.wealth-boost');
        
        wMins.forEach((el, i) => {
            const minVal = parseInt(el.value);
            if (!isNaN(minVal) && minVal > 0) {
                wealthTiers.push({
                    min: minVal,
                    interest: parseFloat(wInts[i].value) || 0,
                    discount: parseInt(wDiscs[i].value) || 0,
                    boost: parseFloat(wBoosts[i].value) || 0
                });
            }
        });

        // 2. เก็บค่า Rank Rules
        const rankRules = {};
        [1, 2, 3].forEach(r => {
            rankRules[r] = {
                interest: parseFloat(document.querySelector(`.rank-int-${r}`).value) || 0,
                discount: parseInt(document.querySelector(`.rank-disc-${r}`).value) || 0,
                boost: parseFloat(document.querySelector(`.rank-boost-${r}`).value) || 0
            };
        });

        const newRules = {
            wealth_tiers: wealthTiers,
            rank_rules: rankRules,
            good_discount: parseInt(document.getElementById('rule-good-discount').value) || 0
        };

        await saveConfig('buff_rules', newRules); // ใช้ saveConfig เดิมที่มีอยู่
        showToast("✅ บันทึกกติกาใหม่เรียบร้อย!");
    } catch (e) {
        alert('Error: ' + e.message);
    }
};
// ฟังก์ชันบันทึก Config กิลด์ (ฉบับสมบูรณ์)
// ==========================================
// บันทึกตั้งค่ากิลด์ (Global Config) 🌍
// ==========================================
window.saveGuildConfig = async () => {
    const maxMembers = parseInt(document.getElementById('config-max-guild-members').value) || 0;
    
    try {
        // บันทึกทีละตัว (หรือจะรวม object ก็ได้ แต่อันนี้ชัวร์สุด)
        await saveConfig('max_guild_members', maxMembers);
       
        
        showToast('✅ บันทึกกฎกิลด์เรียบร้อย (มีผลทันที)');
    } catch (e) {
        alert('Error: ' + e.message);
    }
};

// --- ⏳ SCHEDULED INTEREST SYSTEM FUNCTIONS ---

// 1. บันทึกกำหนดการ
window.saveScheduledInterest = async () => {
    const newRate = parseFloat(document.getElementById('sched-rate').value);
    const days = parseInt(document.getElementById('sched-days').value);

    if (isNaN(newRate) || isNaN(days) || days < 1) return alert('กรุณากรอกข้อมูลให้ครบถ้วน');

    // คำนวณเวลาเป้าหมาย (Current + Days)
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + days); // บวกวัน
    
    try {
        await saveConfig('scheduled_rate', newRate);
        await saveConfig('scheduled_time', targetDate); // Firestore จะแปลงเป็น Timestamp ให้เอง
        showToast(`📅 ตั้งเวลาเปลี่ยนเป็น ${newRate}% ในวันที่ ${targetDate.toLocaleDateString('th-TH')} เรียบร้อย`);
    } catch (e) {
        alert('Error: ' + e.message);
    }
};

// 2. ยกเลิกกำหนดการ
window.cancelScheduledInterest = async () => {
    if(!confirm('ยกเลิกกำหนดการเปลี่ยนแปลงดอกเบี้ย?')) return;
    try {
        // ใช้ deleteField() ต้อง import มาก่อน แต่ในที่นี้เราใช้ saveConfig แบบ merge
        // ซึ่ง saveConfig ปกติรับ key, value
        // เราต้องใช้ updateDoc แบบระบุ field เพื่อลบ (แต่เพื่อความง่าย เราจะเซ็ตเป็น null แทน)
        
        const batch = writeBatch(db);
        const ref = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'school_settings');
        
        batch.update(ref, {
            scheduled_rate: deleteField(),
            scheduled_time: deleteField()
        });
        
        await batch.commit();
        showToast('ยกเลิกเรียบร้อย');
    } catch (e) {
        // Fallback ถ้า deleteField ไม่ทำงาน (เซ็ตเป็น null)
        await saveConfig('scheduled_rate', null);
        await saveConfig('scheduled_time', null);
    }
};

// 3. แสดงผล UI (Banner & Status)
window.checkAndRenderScheduledInterest = () => {
    const banner = document.getElementById('interest-announce-banner');
    const bannerText = document.getElementById('interest-announce-text');
    
    const statusDiv = document.getElementById('sched-status-display');
    const formDiv = document.getElementById('sched-input-form');
    const statusText = document.getElementById('sched-status-text');

    if (config.scheduled_rate && config.scheduled_time) {
        // แปลงเวลา
        let targetTime = config.scheduled_time;
        if (typeof targetTime.toMillis === 'function') targetTime = targetTime.toDate();
        else targetTime = new Date(targetTime);

        const dateStr = targetTime.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
        const rateStr = config.scheduled_rate;

        // A. แสดง Banner ให้นักเรียน (และครู) เห็น
        if (banner && bannerText) {
            banner.classList.remove('hidden');
            bannerText.textContent = `เตรียมพบกับดอกเบี้ยใหม่ ${rateStr}% เริ่มวันที่ ${dateStr} นี้!`;
        }

        // B. ปรับหน้า Settings ของครู (ซ่อนฟอร์ม โชว์สถานะ)
        if (statusDiv && formDiv && statusText) {
            statusDiv.classList.remove('hidden');
            formDiv.classList.add('hidden');
            statusText.innerHTML = `<span class="text-lg">${rateStr}%</span> <span class="text-gray-400 font-normal">ภายในวันที่ ${dateStr}</span>`;
        }

    } else {
        // ไม่มีกำหนดการ -> ซ่อน Banner, โชว์ฟอร์มปกติ
        if (banner) banner.classList.add('hidden');
        if (statusDiv && formDiv) {
            statusDiv.classList.add('hidden');
            formDiv.classList.remove('hidden');
        }
    }
};

// 4. 🤖 ฟังก์ชันเปลี่ยนดอกเบี้ยอัตโนมัติ (ทำงานเหมือนกดเอง แต่ระบบกดให้)
let isExecutingAutoChange = false; // กันรันซ้ำ
window.executeScheduledInterestChange = async () => {
    if (isExecutingAutoChange) return;
    isExecutingAutoChange = true;

    console.log("🤖 Auto Interest Change Triggered!");
    showToast("⏳ ถึงเวลาปรับดอกเบี้ย! ระบบกำลังคำนวณยอดอัตโนมัติ...");

    const newRate = config.scheduled_rate;
    const batch = writeBatch(db);
    let count = 0;

    // Logic เดียวกับ handleInterestRateChange เป๊ะๆ
    students.forEach(s => {
        // ถ้ามีโปรส่วนตัวที่ยังไม่หมดอายุ -> ข้าม
        if (s.special_interest_end) {
            let endTime = s.special_interest_end;
            if (endTime && typeof endTime.toMillis === 'function') endTime = endTime.toMillis();
            if (Date.now() <= endTime) return;
        }

        // คำนวณดอกเบี้ย (เรทเก่า)
        const interest = calculatePendingInterest(s);
        const interestInt = Math.floor(interest);

        if (s.bank_points > 0 || interestInt > 0) {
            const newPrincipal = (s.bank_points || 0) + interestInt;
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
            
            batch.update(sRef, {
                bank_points: newPrincipal,
                bank_deposit_time: serverTimestamp() // รีเซ็ตเวลา
            });
            count++;
        }
    });

    // อัปเดต Config: เปลี่ยนเรทจริง + ลบกำหนดการทิ้ง
    const configRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'school_settings');
    batch.update(configRef, {
        interest_rate: newRate,
        scheduled_rate: deleteField(),
        scheduled_time: deleteField()
    });

    // บันทึก Log ประวัติ (Optional)
    const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
    batch.set(hRef, {
        student_id: 'SYSTEM',
        student_name: 'ระบบอัตโนมัติ',
        action: `ปรับดอกเบี้ยเป็น ${newRate}% (ตามกำหนดการ)`,
        amount: 0,
        type: 'system_auto',
        timestamp: serverTimestamp()
    });

    try {
        await batch.commit();
        showToast(`✅ ปรับดอกเบี้ยเป็น ${newRate}% เรียบร้อย (คำนวณยอดให้ ${count} คน)`);
        isExecutingAutoChange = false;
    } catch (e) {
        console.error("Auto change failed", e);
        alert("ระบบปรับดอกเบี้ยอัตโนมัติขัดข้อง: " + e.message);
        isExecutingAutoChange = false;
    }
};
// --- 📱 PWA REGISTRATION ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('✅ Service Worker Registered!', reg.scope))
            .catch(err => console.log('❌ Service Worker Failed:', err));
    });
}

// ==========================================
// 🛠️ NEW BUFF SYSTEM (ระบบคำนวณบัฟแบบใหม่)
// ==========================================

// 1. ฟังก์ชันดึงค่าบัฟปัจจุบันของกิลด์ (กฎไร้ใบเหลือง)
window.getGuildActiveBuffs = (guildId) => {
const g = guilds.find(x => x.id === guildId);
const rules = window.activeBuffRules || config.buff_rules; 

if (!g || !rules) return { interest: 0, discount: 0, point_boost: 0 };

let totalInterest = 0;
let totalDiscount = 0;
let totalBoost = 0;

// ... (ส่วนคำนวณ Wealth Tiers และ Rank Rules คงไว้เหมือนเดิม) ...
// ... (ก๊อปปี้ส่วน Wealth/Rank จากโค้ดเก่ามาใส่ตรงนี้ได้เลยครับ) ...
// เพื่อความชัวร์ ผมใส่โค้ดเต็มของส่วน Wealth/Rank ให้ด้านล่างนี้ครับ 👇

// --- ส่วนคำนวณ Wealth & Rank (เหมือนเดิม) ---
const allGuildStats = guilds.map(gx => {
        const mems = students.filter(s => s.guild_id === gx.id);
        return { id: gx.id, pts: mems.reduce((sum, s) => sum + (s.points || 0), 0) };
}).sort((a,b) => b.pts - a.pts);
const myStats = allGuildStats.find(x => x.id === guildId);
const myRank = allGuildStats.findIndex(x => x.id === guildId) + 1;
const myPoints = myStats ? myStats.pts : 0;

if (rules.wealth_tiers) {
    const tiers = rules.wealth_tiers.sort((a,b) => b.min - a.min);
    const reached = tiers.find(t => myPoints >= t.min);
    if (reached) {
        totalInterest += (reached.interest || 0);
        totalDiscount += (reached.discount || 0);
        totalBoost += (reached.boost || 0);
    }
}
if (rules.rank_rules) {
    const rankBuff = rules.rank_rules[myRank];
    if (rankBuff) {
        totalInterest += (rankBuff.interest || 0);
        totalDiscount += (rankBuff.discount || 0);
        totalBoost += (rankBuff.boost || 0);
    }
}

// =========================================================
    // 🔥 PART 2: บัฟจากร้านค้ากิลด์ (Active Buffs) - เพิ่มใหม่ตรงนี้ ✅
    // =========================================================
    if (g.active_buffs) {
        const now = Date.now();

        // ฟังก์ชันย่อยสำหรับเช็ควันหมดอายุ
        const getActiveVal = (buffObj) => {
            // ถ้าค่าว่าง
            if (!buffObj) return 0;
            
            // ถ้าเป็น Object (แบบใหม่ มีวันหมดอายุ)
            if (typeof buffObj === 'object' && buffObj.end_time) {
                if (buffObj.end_time > now) {
                    return parseFloat(buffObj.value) || 0; // ยังไม่หมดอายุ -> คืนค่า
                }
                return 0; // หมดอายุแล้ว -> คืนค่า 0
            }
            
            // รองรับเคสเก่า (ถ้ามี) ที่เป็นตัวเลขเพียวๆ
            return parseFloat(buffObj) || 0;
        };

        // บวกค่าพลังจากร้านค้า เข้าไปในตัวแปรสะสม
        totalInterest += getActiveVal(g.active_buffs.interest);
        totalDiscount += getActiveVal(g.active_buffs.discount);
        totalBoost    += getActiveVal(g.active_buffs.point_boost); // ตรงนี้แหละครับที่ทำให้ 150% ทำงาน
    }
// ------------------------------------------

// 🔥🔥🔥 จุดที่แก้: กฎเด็กดี (Good Guild) - เปลี่ยนเป็นเช็คใบเตือน 🔥🔥🔥
const myMembers = students.filter(s => s.guild_id === guildId);

// นับจำนวนใบเตือนรวมของทุกคนในกิลด์
const totalWarningCards = myMembers.reduce((sum, s) => sum + (s.warning_cards || 0), 0);

// เงื่อนไขใหม่: ต้องมีสมาชิก และ "ใบเตือนต้องเป็น 0"
if (myMembers.length > 0 && totalWarningCards === 0) {
    const goodDisc = parseInt(rules.good_discount) || 0;
    totalDiscount += goodDisc;
} 
// ถ้ามีใบเตือนแม้แต่ใบเดียว (totalWarningCards > 0) -> ไม่บวกเพิ่ม
// และถ้าระบบ "ปลาเน่า" ทำงาน (Collective Penalty) มันจะไปตัดส่วนลดทั้งหมดทิ้งอีกที (ตามที่คุยกันรอบก่อน)

// --- เพิ่ม: กฎปลาเน่า (Collective Penalty) ---
// ถ้ามีใบเตือน -> ตัดส่วนลดทั้งหมดทิ้ง (Reset เป็น 0)
if (totalWarningCards > 0) {
    totalDiscount = 0; 
}

return {
    interest: totalInterest,
    discount: Math.min(100, totalDiscount),
    point_boost: totalBoost
};
};

// 2. ฟังก์ชันคำนวณแต้มที่ได้จริง (รวม Boost)
// 2. ฟังก์ชันคำนวณแต้มที่ได้จริง (รวม Boost กิลด์ + ส่วนตัว) 🚀
window.calculateBuffedPoints = (student, basePoints) => {
    const points = parseInt(basePoints);
    if (isNaN(points) || points <= 0) return 0;
    
    let multiplier = 0; // เปอร์เซ็นต์ตัวคูณรวม

    // 1. บัฟจากกิลด์
    if (student.guild_id) {
        const guildBuffs = getGuildActiveBuffs(student.guild_id);
        if (guildBuffs.point_boost > 0) {
            multiplier += guildBuffs.point_boost;
        }
    }

    // 2. บัฟส่วนตัว (จากไอเทม/กาชา) [NEW] ✨
    if (student.buff_points_end) {
        let endTime = student.buff_points_end;
        if (typeof endTime.toMillis === 'function') endTime = endTime.toMillis();
        else if (endTime instanceof Date) endTime = endTime.getTime();

        if (Date.now() < endTime) {
            multiplier += (parseInt(student.buff_points_val) || 0);
        }
    }

    // คำนวณยอดรวม
    if (multiplier > 0) {
        const bonus = Math.floor(points * (multiplier / 100));
        return points + bonus;
    }
    return points;
};

// --- 📂 QUEST CATEGORIES SYSTEM ---

// ตัวแปรเก็บหมวดหมู่ (เริ่มต้นมีค่า Default)
let questCategories = ["ทั่วไป", "การเรียน", "ความประพฤติ", "จิตอาสา"];
let currentCategoryFilter = 'all';

// 1. โหลดหมวดหมู่จาก DB (เรียกใช้ตอน initAppUI)
// ⚠️ ครูออฟต้องเพิ่มบรรทัด loadQuestCategories(); ใน initAppUI() ด้วยนะครับ
async function loadQuestCategories() {
    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'quest_categories');
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data().list) {
            questCategories = snap.data().list;
        } else {
            // ถ้ายังไม่มีใน DB ให้บันทึกค่าเริ่มต้นลงไป
            saveQuestCategoriesToDB(questCategories);
        }
        renderQuestCategoryFilters(); // วาดปุ่ม Filter
    } catch (e) {
        console.error("Load Cat Error", e);
    }
}

// ฟังก์ชันบันทึกลง DB
async function saveQuestCategoriesToDB(list) {
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'quest_categories'), { list: list });
}

// 2. จัดการ Modal หมวดหมู่
window.openManageQuestCategoriesModal = () => {
    renderManageCategoryList();
    document.getElementById('manage-quest-categories-modal').classList.remove('hidden');
};

function renderManageCategoryList() {
    const div = document.getElementById('quest-category-list');
    div.innerHTML = questCategories.map((cat, index) => `
        <div class="flex justify-between items-center bg-gray-50 p-2 rounded border border-gray-100">
            <span class="text-gray-700 text-sm">${cat}</span>
            <button onclick="deleteQuestCategory(${index})" class="text-red-500 hover:text-red-700 text-xs font-bold">ลบ</button>
        </div>
    `).join('');
}

window.addQuestCategory = async () => {
    const input = document.getElementById('new-quest-category-input');
    const val = input.value.trim();
    if (!val) return;
    
    if (!questCategories.includes(val)) {
        questCategories.push(val);
        await saveQuestCategoriesToDB(questCategories);
        renderManageCategoryList();
        renderQuestCategoryFilters();
        input.value = '';
    } else {
        alert('มีหมวดหมู่นี้อยู่แล้ว');
    }
};

window.deleteQuestCategory = async (index) => {
    if (!confirm('ยืนยันลบหมวดหมู่นี้?')) return;
    questCategories.splice(index, 1);
    if(questCategories.length === 0) questCategories.push('ทั่วไป'); // กันว่าง
    await saveQuestCategoriesToDB(questCategories);
    renderManageCategoryList();
    renderQuestCategoryFilters();
};

// 3. Render Filter & Update Select Options
function renderQuestCategoryFilters() {
    // A. Render Filter Tabs
    const container = document.getElementById('quest-category-filters');
    if (container) {
        let html = `<button onclick="filterQuestCategory('all')" class="whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-bold border transition-colors ${currentCategoryFilter === 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}">ทั้งหมด</button>`;
        
        questCategories.forEach(cat => {
            const isActive = currentCategoryFilter === cat;
            html += `<button onclick="filterQuestCategory('${cat}')" class="whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-bold border transition-colors ${isActive ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}">${cat}</button>`;
        });
        container.innerHTML = html;
    }

    // B. Update Select in Add/Edit Modals
    const optionsHtml = questCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    const addSelect = document.getElementById('add-quest-category');
    const editSelect = document.getElementById('edit-quest-category');
    if(addSelect) addSelect.innerHTML = optionsHtml;
    if(editSelect) editSelect.innerHTML = optionsHtml;
}

window.filterQuestCategory = (cat) => {
    currentCategoryFilter = cat;
    renderQuestCategoryFilters(); // Update active state
    renderQuests(); // Re-render table
};

// --- 🚀 UPDATE QUEST RENDER (TABLE VERSION) ---
// แทนที่ renderQuests เดิม

// ==========================================
// 🏦 BANK TRANSACTION SYSTEM (ระบบฝากถอน - ฉบับสมบูรณ์)
// ==========================================
window.handleBankTransaction = async () => {
    // 1. ดึงค่าจากหน้าจอ
    const studentId = document.getElementById('bank-student-id').value;
    const type = document.getElementById('bank-transaction-type').value; // 'deposit' หรือ 'withdraw'
    const amount = parseInt(document.getElementById('bank-amount').value);
    const reason = document.getElementById('bank-note').value.trim();

    // 2. ตรวจสอบข้อมูลเบื้องต้น
    if (!studentId || isNaN(amount) || amount <= 0) {
        alert('กรุณาระบุจำนวนแต้มที่ถูกต้อง');
        return;
    }

    // 3. หาข้อมูลนักเรียน
    const s = students.find(x => x.id === studentId);
    if (!s) return;

    // 4. เช็คยอดเงิน
    // กรณีถอน: เช็คยอดในธนาคาร
    if (type === 'withdraw') {
        const currentBank = s.bank_points || 0;
        const pendingInterest = Math.floor(calculatePendingInterest(s));
        const totalAvailable = currentBank + pendingInterest; 
        if (amount > totalAvailable) {
            alert(`ยอดเงินในธนาคารไม่พอถอน (มี ${totalAvailable.toLocaleString()} แต้ม)`);
            return;
        }
    }
    // ✨ กรณีฝาก: เช็คแต้มในตัว (เพราะต้องหักแต้มจากตัวเสมอ)
    if (type === 'deposit') {
        const currentPoints = s.points || 0;
        if (amount > currentPoints) {
            alert(`แต้มพกติดตัวไม่พอฝาก (มี ${currentPoints.toLocaleString()} แต้ม)`);
            return;
        }
    }

    // 5. เตรียมบันทึกลงฐานข้อมูล
    const batch = writeBatch(db);
    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', studentId);
    const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

    // --- คำนวณยอดเงินในธนาคารใหม่ ---
    const pendingInterest = Math.floor(calculatePendingInterest(s));
    let newPrincipal = (s.bank_points || 0) + pendingInterest;

    if (type === 'deposit') {
        newPrincipal += amount;
    } else {
        newPrincipal -= amount;
    }

    batch.update(sRef, {
        bank_points: newPrincipal,
        bank_deposit_time: serverTimestamp() 
    });

    // --- 💰 จัดการแต้มพกติดตัว (Points) ---
    // ✅ แก้ไข: หัก/เพิ่มแต้มเสมอ ไม่ว่าใครจะเป็นคนกด
    if (type === 'withdraw') {
         // ถอน = เงินเข้าตัว
         batch.update(sRef, { points: increment(amount) });
    } else if (type === 'deposit') {
         // ฝาก = เงินออกจากตัว (หักเสมอ!)
         batch.update(sRef, { points: increment(-amount) });
    }

    // --- 🕵️‍♂️ ระบุตัวคนกด (Actor) ---
    // เช็ค Role คนปัจจุบัน
    let actorLabel = userRole === 'teacher' ? '(ครู)' : '(นักเรียน)';
    
    // ชื่อรายการที่จะบันทึก
    const actionText = type === 'deposit' ? 'ฝากแต้ม' : 'ถอนแต้ม';

    // 6. บันทึกประวัติ (History)
    batch.set(hRef, {
        student_id: s.id,
        student_name: s.full_name,
        action: `${actionText} ${actorLabel}`, // เช่น "ฝากแต้ม (นักเรียน)"
        amount: amount,
        reason: reason || (type === 'deposit' ? 'ฝากธนาคาร' : 'ถอนจากธนาคาร'),
        type: type === 'deposit' ? 'bank_deposit' : 'bank_withdraw',
        timestamp: serverTimestamp()
    });

    // 7. ส่งข้อมูล (Commit)
    try {
        await batch.commit();
        hideBankModal();
        showToast(`${actionText} ${amount} แต้ม สำเร็จ!`);
    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

// ==========================================
// 🏦 BANK HELPER: จัดการปุ่มฝาก/ถอนทั้งหมด
// ==========================================
window.handleBankAll = (type) => {
    // 1. ดึงข้อมูลนักเรียน
    const studentId = document.getElementById('bank-student-id').value;
    const s = students.find(x => x.id === studentId);
    if (!s) return;

    let amount = 0;

    // 2. คำนวณยอดเงินที่จะทำรายการ
    if (type === 'deposit') {
        // ฝากหมด = เอาแต้มในกระเป๋าทั้งหมดมา
        amount = Math.floor(s.points || 0);
    } else {
        // ถอนหมด = เอาเงินต้น + ดอกเบี้ย ทั้งหมดมา
        const interest = Math.floor(calculatePendingInterest(s));
        amount = (s.bank_points || 0) + interest;
    }

    // 3. ตรวจสอบความถูกต้อง
    if (amount <= 0) {
        return alert(type === 'deposit' ? 'ไม่มีแต้มในกระเป๋าให้ฝากครับ' : 'ไม่มีเงินในธนาคารให้ถอนครับ');
    }

    // 4. กรอกค่าลงในช่อง Input อัตโนมัติ แล้วสั่งทำงานเลย
    document.getElementById('bank-amount').value = amount;
    document.getElementById('bank-transaction-type').value = type;
    
    // เรียกฟังก์ชันหลักเพื่อบันทึกข้อมูล
    handleBankTransaction();
};

// ==========================================
// 🎁 BULK GIVE GACHA SYSTEM (ระบบแจกกล่องสุ่มฟรี)
// ==========================================

// 1. เปิดหน้าต่างเลือกของ (กรองเฉพาะกล่องสุ่ม 🎲)
window.showBulkGiveRewardModal = () => {
    // เช็คว่าเลือกนักเรียนหรือยัง?
    if (selectedStudentIds.size === 0) return alert('กรุณาเลือกนักเรียนก่อนครับ (ติ๊กถูกหน้ารายชื่อ)');
    
    const container = document.getElementById('bulk-give-list');
    const previewEl = document.getElementById('bulk-give-preview');
    const qtyInput = document.getElementById('bulk-give-qty');
    
    // รีเซ็ตจำนวนเป็น 1 เสมอตอนเปิดใหม่
    if(qtyInput) qtyInput.value = 1;

    // แสดงรายชื่อคนที่จะได้รับ (Preview)
    const selectedNames = Array.from(selectedStudentIds)
        .map(id => students.find(s => s.id === id)?.full_name)
        .filter(n => n).join(', ');
    previewEl.textContent = `ผู้รับรางวัล (${selectedStudentIds.size} คน): ${selectedNames}`;

    // 🔍 กรองเฉพาะ "กล่องสุ่ม (gacha_custom)" เท่านั้น
    const gachaRewards = rewards.filter(r => r.type === 'gacha_custom');

    if (gachaRewards.length === 0) {
        container.innerHTML = `
            <div class="text-center py-6 text-gray-400 flex flex-col items-center">
                <span class="text-3xl mb-2">🎲</span>
                <p>ไม่พบ "กล่องสุ่ม" ในร้านค้าครับ</p>
                <p class="text-xs mt-1">(ต้องไปสร้างของรางวัลประเภท "Custom Gacha" ก่อน)</p>
            </div>`;
    } else {
        // สร้างรายการให้เลือก (Radio Button)
        container.innerHTML = gachaRewards.map(r => `
            <label class="flex items-center gap-3 p-3 bg-white border rounded-xl cursor-pointer hover:border-purple-500 hover:shadow-md transition-all group select-none">
                <input type="radio" name="bulk-give-item" value="${r.id}" class="w-5 h-5 text-purple-600 focus:ring-purple-500">
                
                <div class="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden shrink-0 border border-gray-200">
                    ${r.image ? `<img src="${r.image}" class="w-full h-full object-cover">` : '<span class="text-2xl">🎲</span>'}
                </div>
                
                <div class="flex-1">
                    <div class="flex justify-between items-center">
                        <p class="font-bold text-gray-800 text-sm group-hover:text-purple-700">${r.name}</p>
                        <span class="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold">ฟรี</span>
                    </div>
                    <p class="text-[10px] text-gray-400">มูลค่าปกติ: ${r.points} แต้ม</p>
                </div>
            </label>
        `).join('');
    }

    document.getElementById('bulk-give-reward-modal').classList.remove('hidden');
    document.getElementById('bulk-give-reward-modal').classList.add('flex');
};

// 2. ปรับจำนวนชิ้น (+/-)
window.adjustBulkGiveQty = (delta) => {
    const input = document.getElementById('bulk-give-qty');
    let val = parseInt(input.value) || 1;
    val += delta;
    if (val < 1) val = 1; // ห้ามต่ำกว่า 1
    input.value = val;
};

// 3. ยืนยันการแจก (Logic สำคัญอยู่ตรงนี้!)
window.confirmBulkGiveReward = async () => {
    const selectedRadio = document.querySelector('input[name="bulk-give-item"]:checked');
    if (!selectedRadio) return alert('กรุณาเลือกกล่องสุ่มที่จะแจกก่อนครับ');
    
    const rewardId = selectedRadio.value;
    const reward = rewards.find(r => r.id === rewardId);
    const qty = parseInt(document.getElementById('bulk-give-qty').value) || 1;
    
    if (!reward) return;

    // ถามยืนยันเพื่อความชัวร์
    showConfirmModal(
        '🎁 ยืนยันการแจกฟรี', 
        `ต้องการแจก "${reward.name}" จำนวน ${qty} กล่อง\nให้นักเรียน ${selectedStudentIds.size} คน ใช่หรือไม่?\n\n(แต้มจะไม่ลด และสต็อกร้านค้าจะไม่หาย)`, 
        async () => {
            const batch = writeBatch(db);
            const timestamp = serverTimestamp();
            const now = Date.now();
            const daysToExpire = 7;
            const expireDate = new Date();
            expireDate.setDate(expireDate.getDate() + daysToExpire);
            const expireString = expireDate.toISOString();
            let successCount = 0;

            selectedStudentIds.forEach(sid => {
                const s = students.find(std => std.id === sid);
                if (s) {
                    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
                    const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

                    // สร้างไอเทมใหม่ (Generate Items)
                    // เทคนิค: สร้าง Array ตามจำนวน qty แล้ว Map เป็น Object ไอเทม
                    const newItems = Array(qty).fill().map(() => ({
                        id: crypto.randomUUID(), // สร้าง ID ไม่ซ้ำให้ไอเทมแต่ละชิ้น
                        reward_id: reward.id,
                        name: reward.name,
                        image: reward.image,
                        type: 'gacha_box', // ระบุประเภทว่าเป็นกล่องสุ่ม
                        effect: reward.effect || 'none',
                        acquired_at: now,
                        gacha_pool: reward.gacha_pool || null,
                        expired_at: expireString
                    }));

                    // 1. ยัดใส่กระเป๋านักเรียน (Inventory)
                    batch.update(sRef, { inventory: arrayUnion(...newItems) });

                    // 2. บันทึกประวัติ (History) - ระบุว่าได้รับฟรี
                    batch.set(hRef, {
                        student_id: s.id,
                        student_name: s.full_name,
                        action: `🎁 ได้รับกล่องสุ่มฟรี: ${reward.name} (x${qty})`,
                        amount: 0, // 👈 สำคัญ: ใส่ 0 เพื่อไม่ให้กราฟแต้มเพี้ยน
                        type: 'add_points', // ใช้ type นี้เพื่อให้เล่นเสียงเหรียญตอนได้รับ (Coin Sound)
                        timestamp: timestamp
                    });
                    
                    successCount++;
                }
            });

            try {
                await batch.commit();
                
                // ปิด Modal
                document.getElementById('bulk-give-reward-modal').classList.add('hidden');
                document.getElementById('bulk-give-reward-modal').classList.remove('flex');

                // แจ้งเตือน + เล่นเสียง
                showToast(`✅ แจกกล่องสุ่มสำเร็จ! (${successCount} คน)`);
                if(window.soundCoin) window.soundCoin.play();
                
                // เคลียร์การเลือก (Reset Selection)
                selectedStudentIds.clear();
                updateBulkUI(); // ซ่อนแถบเมนูด้านบน
                renderStudentList(false); // รีเฟรชรายชื่อเพื่อเอาติ๊กถูกออก

            } catch (e) {
                console.error(e);
                alert('เกิดข้อผิดพลาด: ' + e.message);
            }
        }
    );
};

// --- ⚠️ PUNISHMENT & WARNING SYSTEM ---

window.adjustWarning = async (id, amount) => {
    const s = students.find(x => x.id === id);
    if (!s) return;
    
    const currentWarning = parseInt(s.warning_cards || 0);
    const newWarning = Math.max(0, currentWarning + amount);
    
    if (newWarning === currentWarning) return;

    let updateData = { warning_cards: newWarning };
    let msg = '';
    
    // ตรวจสอบสถานะการเปลี่ยน (Transition)
    const isFreezing = (currentWarning === 0 && newWarning > 0);   // เริ่มโดนใบเตือน
    const isUnfreezing = (currentWarning > 0 && newWarning === 0); // ปลดใบเตือนหมด

    // 1. กรณีเริ่มโดนแบน (Freeze): ต้องทบต้นดอกเบี้ยเก่าเก็บไว้ก่อน + รีเซ็ตเวลา
    if (isFreezing) {
        // 🔥 สร้าง Temp Student ที่ไม่มีใบเตือน เพื่อบังคับให้คำนวณดอกเบี้ยออกมาให้ได้
        const tempStudent = { ...s, warning_cards: 0 }; 
        const interest = calculatePendingInterest(tempStudent);
        
        if (interest > 0) {
            const compoundAmount = Math.floor(interest);
            // ทบต้นเฉพาะยอดที่ > 0 (ขั้นต่ำ 1 แต้ม)
            if (compoundAmount > 0) {
                updateData.bank_points = increment(compoundAmount);
                msg += ` และทบดอกเบี้ยสะสม ${compoundAmount.toLocaleString()} แต้ม`;
            }
        }
        // ✅ รีเซ็ตเวลาฝากเป็น "ณ ตอนนี้" เพื่อจบรอบการคำนวณเก่า
        updateData.bank_deposit_time = serverTimestamp();
    }
    
    // 2. กรณีพ้นโทษ (Unfreeze): รีเซ็ตเวลาเริ่มนับใหม่ (เริ่มนับ 0 ใหม่จากวินาทีนี้)
    else if (isUnfreezing) {
         updateData.bank_deposit_time = serverTimestamp();
    }

    // 3. กรณีพ้นโทษ: คืนแต้มที่อายัดไว้ (Pending Points)
    if (isUnfreezing && (s.pending_points || 0) > 0) {
        const returnPoints = s.pending_points;
        updateData.points = increment(returnPoints);
        updateData.pending_points = 0;
        msg += ` (คืนแต้มอายัด ${returnPoints.toLocaleString()})`;
        
        const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
        await setDoc(hRef, {
            student_id: s.id,
            student_name: s.full_name,
            action: 'พ้นโทษใบเตือน (คืนแต้มอายัด)',
            amount: returnPoints,
            type: 'add_points',
            timestamp: serverTimestamp()
        });
    }

    // อัปเดตข้อมูลนักเรียน
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', id), updateData);
    
    // Log การให้ใบเตือน
    const actionText = amount > 0 ? `ได้รับใบเตือน (${newWarning})` : `ลดใบเตือน (${newWarning})`;
    showToast(`⚠️ ${s.full_name} ${actionText}${msg}`);
};

// ฟังก์ชันเพิ่มภารกิจ (ปุ่ม + สีเหลือง) ที่หายไป
window.addMission = async (id) => {
    const input = document.getElementById(`mission-input-${id}`);
    if (!input) return;
    
    const text = input.value.trim();
    if (!text) {
        showToast('กรุณากรอกชื่อภารกิจ', 'error');
        return;
    }

    const s = students.find(x => x.id === id);
    if (!s) return;

    // เพิ่มภารกิจใหม่ต่อท้าย
    const missions = [...(s.active_missions || []), text];
    
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', id), {
            active_missions: missions
        });
        input.value = ''; // เคลียร์ช่องกรอก
        showToast('เพิ่มภารกิจเรียบร้อย ✅');
    } catch (err) {
        console.error(err);
        showToast('เกิดข้อผิดพลาดในการบันทึก', 'error');
    }
};

// แสดงหน้าคุมประพฤติ (เรียกตอนกดแท็บ หรือ refresh)
// เก็บ ID นักเรียนที่ถูกเลือกในหน้าคุมประพฤติ
window.selectedPunishmentIds = new Set();
// แสดงหน้าคุมประพฤติ (อัปเกรดใหม่: Checkbox + Edit/Delete)
window.renderPunishmentList = () => {
    const container = document.getElementById('punishment-list');
    if (!container) return;

    const guiltyStudents = students.filter(s => (s.warning_cards || 0) > 0);
    
    // ... (ส่วนหัว Header คงเดิม) ...
    const countBadge = document.getElementById('punishment-count');
    if (countBadge) countBadge.textContent = guiltyStudents.length;
    
    // Header HTML (คงเดิม)
    let headerHtml = '';
    if (guiltyStudents.length > 0) {
        headerHtml = `
        <div class="flex justify-between items-center mb-4 px-2 sticky top-0 bg-white/90 backdrop-blur-sm z-20 py-2 border-b">
            <div class="text-sm text-gray-500 font-bold">
                เลือก <span id="punishment-sel-count" class="text-indigo-600">${selectedPunishmentIds.size}</span> คน
            </div>
            <div class="flex gap-2">
                 ${selectedPunishmentIds.size > 0 ? `
                    <button onclick="bulkAddMission()" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5 rounded-lg font-bold shadow-sm flex items-center gap-1 transition-all animate-bounce-in">
                        📝 เพิ่มภารกิจกลุ่ม
                    </button>
                    <button onclick="clearPunishmentSelection()" class="bg-gray-200 hover:bg-gray-300 text-gray-600 text-xs px-3 py-1.5 rounded-lg font-bold">
                        ยกเลิกเลือก
                    </button>
                ` : ''}
            </div>
        </div>`;
    }

    if (guiltyStudents.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-400 py-10 flex flex-col items-center">
            <span class="text-4xl mb-2">🕊️</span>
            <span>ห้องเรียนสงบสุข ไม่มีใครโดนใบเตือน</span>
        </div>`;
        return;
    }

    // --- ส่วนที่แก้คือตรง map ด้านล่างนี้ครับ ---
    const listHtml = guiltyStudents.map(s => {
        const isSelected = selectedPunishmentIds.has(s.id);
        return `
        <div class="flex flex-col md:flex-row gap-4 items-start bg-yellow-50 p-4 rounded-lg border ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-yellow-200'} shadow-sm relative overflow-hidden transition-all">
            
            <div class="absolute top-3 left-3 z-20">
                <input type="checkbox" onchange="togglePunishmentSelect('${s.id}')" ${isSelected ? 'checked' : ''} class="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer">
            </div>
            <div class="absolute top-0 right-0 p-2 opacity-10 text-6xl pointer-events-none">⚠️</div>
            
            <div class="flex-1 z-10 pl-8">
                <div class="flex items-center gap-2 mb-1">
                    <span class="font-bold text-lg text-gray-800 cursor-pointer" onclick="togglePunishmentSelect('${s.id}')">${s.full_name}</span>
                    <span class="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded border border-red-200 whitespace-nowrap">โดน ${s.warning_cards} ใบ</span>
                </div>
                <div class="text-sm text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
                    <span>เลขที่: ${s.student_id}</span>
                    <span class="font-bold text-red-500">🔒 อายัด: ${s.pending_points || 0} แต้ม</span>
                </div>
            </div>

            <div class="flex-1 w-full z-10 pl-8 md:pl-0">
                <p class="text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-wider">ภารกิจลบล้างโทษ</p>
                <ul class="space-y-2 mb-2">
                    ${(s.active_missions || []).map((m, idx) => `
                        <li class="flex items-center justify-between bg-white p-2 rounded border border-yellow-200 text-sm shadow-sm group hover:border-yellow-400 transition-colors">
                            <div class="flex items-center gap-2 flex-1 mr-2">
                                <span class="text-gray-700 break-words">${m}</span>
                                
                                <button onclick="editMission('${s.id}', ${idx})" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity" title="แก้ไขข้อความ">
                                    ✏️
                                </button>
                            </div>
                            <div class="flex items-center gap-1 shrink-0">
                                <button onclick="deleteMission('${s.id}', ${idx})" class="text-gray-300 hover:text-red-500 p-1 hover:bg-red-50 rounded transition-colors" title="ลบรายการนี้">
                                    🗑️
                                </button>
                                <button onclick="removeMission('${s.id}', ${idx})" class="text-green-600 hover:text-green-800 text-xs font-bold bg-green-50 px-2 py-1 rounded hover:bg-green-100 border border-green-200 transition-colors shadow-sm ml-1">
                                    ✅ สำเร็จ
                                </button>
                            </div>
                        </li>
                    `).join('')}
                    ${(!s.active_missions || s.active_missions.length === 0) ? '<li class="text-xs text-gray-400 italic">- ยังไม่มีภารกิจ -</li>' : ''}
                </ul>
                <div class="flex gap-2">
                    <input type="text" id="mission-input-${s.id}" placeholder="เพิ่มภารกิจ..." class="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-yellow-400 outline-none" onkeydown="if(event.key==='Enter') addMission('${s.id}')">
                    <button onclick="addMission('${s.id}')" class="bg-yellow-500 hover:bg-yellow-600 text-white text-xs px-3 py-1 rounded shadow-sm font-bold">+</button>
                </div>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = headerHtml + listHtml;
};

// เพิ่มภารกิจ
// 3. แก้ไขข้อความภารกิจ (Edit) - แบบปลอดภัย
window.editMission = async (id, idx) => {
    // ดึงข้อมูลล่าสุดจากตัวแปร global (ไม่ต้องรับ text จาก HTML)
    const s = students.find(x => x.id === id);
    if (!s || !s.active_missions) return;
    
    const oldText = s.active_missions[idx]; // ดึงข้อความเดิมมาโชว์

    const { value: newText } = await Swal.fire({
        title: '✏️ แก้ไขภารกิจ',
        input: 'text',
        inputValue: oldText, // เอาข้อความเดิมใส่ลงไป
        showCancelButton: true,
        confirmButtonText: 'บันทึก',
        cancelButtonText: 'ยกเลิก'
    });

    if (newText && newText !== oldText) {
        const missions = [...(s.active_missions || [])];
        missions[idx] = newText;

        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', id), {
            active_missions: missions
        });
        showToast('แก้ไขเรียบร้อย');
    }
};
// ลบภารกิจ (ทำสำเร็จ) + ลดใบเตือน + รีเซ็ตดอกเบี้ยถ้าพ้นโทษ
window.removeMission = async (studentId, missionIndex) => {
    if(!confirm('ยืนยันว่านักเรียนทำภารกิจนี้สำเร็จแล้ว?')) return;

    const s = students.find(x => x.id === studentId);
    if (!s) return;

    let missions = [...(s.active_missions || [])];
    missions.splice(missionIndex, 1); // ลบภารกิจออก
    
    // ลดใบเตือนลง 1 ใบ
    const currentWarning = s.warning_cards || 0;
    const newWarning = Math.max(0, currentWarning - 1);
    
    let updateData = { 
        active_missions: missions,
        warning_cards: newWarning
    };

    // 🔥 LOGIC ที่เพิ่ม: ถ้าพ้นโทษแล้ว (ใบเตือนเป็น 0) ให้รีเซ็ตเวลาฝาก เพื่อเริ่มนับดอกเบี้ยใหม่
    if (currentWarning > 0 && newWarning === 0) {
         updateData.bank_deposit_time = serverTimestamp();
    }

    // คืนแต้มที่อายัด (ถ้ามี)
    if (newWarning === 0 && (s.pending_points || 0) > 0) {
        const returnPoints = s.pending_points;
        updateData.points = increment(returnPoints);
        updateData.pending_points = 0;
        showToast(`🎉 ${s.full_name} พ้นโทษแล้ว! ได้คืน ${returnPoints} แต้ม`);
        
        // Log การคืนแต้ม
        const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
        await setDoc(hRef, {
            student_id: s.id,
            student_name: s.full_name,
            action: 'ทำภารกิจครบ (คืนแต้มอายัด)',
            amount: returnPoints,
            type: 'add_points',
            timestamp: serverTimestamp()
        });
    } else {
        showToast(`✅ ภารกิจสำเร็จ! ใบเตือนเหลือ ${newWarning}`);
    }

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', studentId), updateData);
};

// --- ⚠️ BULK WARNING WITH MODAL ---

// 1. ปรับตัวเลขใน Modal
window.adjustWarningInput = (delta) => {
    const input = document.getElementById('bulk-warning-amount');
    let val = parseInt(input.value) || 1;
    val = Math.max(1, val + delta);
    input.value = val;
};

// 2. เปิด Modal
window.showBulkWarningModal = (type) => {
    if (selectedStudentIds.size === 0) return alert('กรุณาเลือกนักเรียนก่อนครับ');

    const isAdd = type === 'add';
    
    // ตั้งค่า UI
    document.getElementById('bulk-warning-type').value = type;
    document.getElementById('bulk-warning-amount').value = 1;
    document.getElementById('bulk-warning-reason').value = '';
    
    document.getElementById('bulk-warning-title').textContent = isAdd ? 'แจกใบเตือน' : 'ลดใบเตือน';
    document.getElementById('bulk-warning-subtitle').textContent = `ทำรายการให้นักเรียน ${selectedStudentIds.size} คน`;
    
    // เปลี่ยนสีตามประเภท
    const iconBg = document.getElementById('bw-icon-bg');
    const confirmBtn = document.getElementById('btn-confirm-warning');
    
    if (isAdd) {
        iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl shadow-inner bg-yellow-100 text-yellow-600";
        confirmBtn.className = "flex-1 py-3 text-white bg-yellow-500 hover:bg-yellow-600 rounded-xl font-bold shadow-lg";
        iconBg.innerHTML = '⚠️';
    } else {
        iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl shadow-inner bg-green-100 text-green-600";
        confirmBtn.className = "flex-1 py-3 text-white bg-green-600 hover:bg-green-700 rounded-xl font-bold shadow-lg";
        iconBg.innerHTML = '🛡️';
    }

    document.getElementById('bulk-warning-modal').classList.remove('hidden');
    document.getElementById('bulk-warning-modal').classList.add('flex');
};

// 3. ยืนยันการทำรายการ (บันทึกประวัติ + Logic คืนแต้ม + Logic ดอกเบี้ยแช่แข็ง)
window.confirmBulkWarning = async () => {
    const type = document.getElementById('bulk-warning-type').value;
    const amountInput = parseInt(document.getElementById('bulk-warning-amount').value) || 1;
    const reason = document.getElementById('bulk-warning-reason').value.trim();
    const isAdd = type === 'add';

    // ปิด Modal
    document.getElementById('bulk-warning-modal').classList.add('hidden');
    document.getElementById('bulk-warning-modal').classList.remove('flex');

    showToast('กำลังบันทึกข้อมูล... ⏳');

    const batch = writeBatch(db);
    const timestamp = serverTimestamp();
    let count = 0;
    let releasedCount = 0;

    // คำนวณค่าที่จะบวก/ลบ (ถ้าลบใบเตือน ให้ค่าติดลบ)
    const changeAmount = isAdd ? amountInput : -amountInput;

    selectedStudentIds.forEach(id => {
        const s = students.find(x => x.id === id);
        if (!s) return;

        const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
        const currentWarnings = s.warning_cards || 0;
        
        // คำนวณใบเตือนใหม่ (ห้ามต่ำกว่า 0)
        const newWarnings = Math.max(0, currentWarnings + changeAmount);
        
        // ถ้าค่าไม่เปลี่ยน (เช่น เป็น 0 อยู่แล้ว แล้วกดลบ) ก็ข้ามไป
        if (newWarnings === currentWarnings) return;

        const updates = { warning_cards: newWarnings };
        const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

        // --- 🔥 LOGIC จัดการดอกเบี้ย (เพิ่มใหม่) ---
        const isFreezing = (currentWarnings === 0 && newWarnings > 0);   // สถานะ: เริ่มโดนแบน
        const isUnfreezing = (currentWarnings > 0 && newWarnings === 0); // สถานะ: พ้นโทษ

        if (isFreezing) {
            // 1. จำลองสถานะก่อนโดนใบเตือน (ใบเตือน=0) เพื่อคำนวณดอกเบี้ยที่ค้างอยู่
            const tempS = { ...s, warning_cards: 0 };
            const interest = calculatePendingInterest(tempS);
            const interestInt = Math.floor(interest);

            // ทบดอกเบี้ยเข้าเงินต้นทันที
            if (interestInt > 0) {
                updates.bank_points = increment(interestInt);
            }
            // รีเซ็ตเวลาฝาก เพื่อ "แช่แข็ง" (ดอกเบี้ยจะไม่เดินต่อจากจุดนี้เพราะมีใบเตือนแล้ว)
            updates.bank_deposit_time = timestamp;
        } 
        else if (isUnfreezing) {
            // 2. พ้นโทษแล้ว รีเซ็ตเวลาฝากใหม่ เพื่อเริ่มนับดอกเบี้ยต่อจากวินาทีนี้
            updates.bank_deposit_time = timestamp;
        }
        // ----------------------------------------

        // 📝 1. บันทึกประวัติใบเตือน
        batch.set(hRef, {
            student_id: s.id,
            student_name: s.full_name,
            action: isAdd ? `โดนใบเตือน (${amountInput} ใบ)` : `ลบใบเตือน (${amountInput} ใบ)`,
            amount: amountInput, 
            reason: reason || (isAdd ? 'พฤติกรรมไม่เหมาะสม' : 'ทำความดีชดเชย'),
            type: 'warning_card_log', 
            timestamp: timestamp
        });

        // 🔓 2. เช็คเงื่อนไขพิเศษ: ถ้าใบเตือนหมด -> คืนแต้มที่อายัด! (Logic เดิม)
        if (isUnfreezing && (s.pending_points || 0) > 0) {
            const returnPoints = s.pending_points;
            updates.points = increment(returnPoints);
            updates.pending_points = 0;
            
            // Log การคืนแต้ม
            const hRef2 = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
            batch.set(hRef2, {
                student_id: s.id,
                student_name: s.full_name,
                action: 'พ้นโทษแบน (คืนแต้มอายัด)',
                amount: returnPoints,
                type: 'add_points',
                reason: 'ใบเตือนเหลือ 0',
                timestamp: timestamp
            });
            releasedCount++;
        }

        batch.update(sRef, updates);
        count++;
    });

    if (count > 0) {
        try {
            await batch.commit();
            let msg = `✅ บันทึกสำเร็จ ${count} คน`;
            if (releasedCount > 0) msg += ` (พ้นโทษ ${releasedCount} คน)`;
            showToast(msg);
            
            // เคลียร์การเลือก
            selectedStudentIds.clear();
            updateBulkUI();
            renderStudentList(false);
        } catch (e) {
            console.error(e);
            alert('เกิดข้อผิดพลาด: ' + e.message);
        }
    } else {
        showToast('ไม่มีการเปลี่ยนแปลงข้อมูล (ใบเตือนเป็น 0 อยู่แล้ว)');
    }
};

// --- 🛠️ PUNISHMENT TOOLS (Select, Bulk Add, Edit, Delete) ---

// 1. เลือก/ไม่เลือก นักเรียน (Checkbox)
window.togglePunishmentSelect = (id) => {
    if (selectedPunishmentIds.has(id)) {
        selectedPunishmentIds.delete(id);
    } else {
        selectedPunishmentIds.add(id);
    }
    renderPunishmentList(); // รีเฟรชหน้าเพื่อโชว์ปุ่ม
};

window.clearPunishmentSelection = () => {
    selectedPunishmentIds.clear();
    renderPunishmentList();
};

// 2. เพิ่มภารกิจกลุ่ม (Bulk Add)
window.bulkAddMission = async () => {
    if (selectedPunishmentIds.size === 0) return;

    const { value: mission } = await Swal.fire({
        title: '📝 เพิ่มภารกิจกลุ่ม',
        input: 'text',
        inputLabel: `มอบหมายภารกิจให้ ${selectedPunishmentIds.size} คน`,
        inputPlaceholder: 'เช่น ช่วยครูยกของ, กวาดห้อง...',
        showCancelButton: true,
        confirmButtonText: 'บันทึก',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#4f46e5'
    });

    if (mission) {
        const batch = writeBatch(db);
        let count = 0;

        selectedPunishmentIds.forEach(id => {
            const s = students.find(x => x.id === id);
            if (s) {
                const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', id);
                const newMissions = [...(s.active_missions || []), mission];
                batch.update(sRef, { active_missions: newMissions });
                count++;
            }
        });

        await batch.commit();
        showToast(`✅ เพิ่มภารกิจให้ ${count} คนเรียบร้อย`);
        selectedPunishmentIds.clear(); // เคลียร์การเลือกหลังทำเสร็จ
        renderPunishmentList(); // รีเฟรช
    }
};

// 3. แก้ไขข้อความภารกิจ (Edit)
window.editMission = async (id, idx, oldText) => {
    const { value: newText } = await Swal.fire({
        title: '✏️ แก้ไขภารกิจ',
        input: 'text',
        inputValue: oldText,
        showCancelButton: true,
        confirmButtonText: 'บันทึก',
        cancelButtonText: 'ยกเลิก'
    });

    if (newText && newText !== oldText) {
        const s = students.find(x => x.id === id);
        if (!s) return;

        const missions = [...(s.active_missions || [])];
        missions[idx] = newText; // อัปเดตข้อความ

        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', id), {
            active_missions: missions
        });
        showToast('แก้ไขเรียบร้อย');
    }
};

// 4. ลบภารกิจทิ้ง (Delete) - ไม่ลดใบเตือน
window.deleteMission = async (id, idx) => {
    const result = await Swal.fire({
        title: 'ลบรายการนี้?',
        text: "ภารกิจจะหายไป แต่ใบเตือนจะไม่ลดลงนะครับ (ใช้กรณีพิมพ์ผิด)",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'ลบทิ้ง',
        cancelButtonText: 'ยกเลิก'
    });

    if (result.isConfirmed) {
        const s = students.find(x => x.id === id);
        if (!s) return;

        const missions = [...(s.active_missions || [])];
        missions.splice(idx, 1); // ลบออกจาก array

        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', id), {
            active_missions: missions
        });
        showToast('ลบรายการแล้ว');
    }
};

// --- ⚡ QUEST DISTRIBUTION LOGIC (NEW) ---

// ตัวแปรสำหรับจำค่า (Global Variables)
let tempQuestDistSelection = new Set(); // จำรายชื่อคนถูกเลือก
let currentQuestDistId = null;          // จำ ID ภารกิจที่กำลังทำ

// 1. ฟังก์ชันเปิด Modal (แทนที่ executeBulkQuest เดิมในปุ่ม HTML)
window.executeBulkQuest = (questId) => {
    const quest = quests.find(q => q.id === questId);
    if (!quest) return;

    currentQuestDistId = questId;
    
    // ตั้งค่า UI
    document.getElementById('quest-dist-title').textContent = `${quest.icon} ${quest.title} (+${quest.points} แต้ม)`;
    document.getElementById('quest-dist-qty').value = 1;
    document.getElementById('quest-dist-search').value = '';

    // ✨ พิเศษ: ถ้ามีการเลือกนักเรียนค้างไว้จากหน้าหลัก (Select All) ให้ดึงมาใส่เลย
    if (selectedStudentIds.size > 0) {
        tempQuestDistSelection = new Set(selectedStudentIds);
    } else {
        tempQuestDistSelection.clear();
    }

    renderQuestStudentSelector(); // วาดรายชื่อ
    document.getElementById('quest-distribution-modal').classList.remove('hidden');
    document.getElementById('quest-distribution-modal').classList.add('flex');
};

// 2. ฟังก์ชันวาดรายชื่อนักเรียน (พร้อมระบบค้นหา & จำค่า)
window.renderQuestStudentSelector = () => {
    const container = document.getElementById('quest-dist-list');
    const search = document.getElementById('quest-dist-search').value.toLowerCase().trim();
    const countEl = document.getElementById('quest-dist-count');

    // กรองข้อมูล
    let filtered = students.filter(s => 
        s.full_name.toLowerCase().includes(search) || 
        s.student_id.includes(search) ||
        (s.class_name && s.class_name.toLowerCase().includes(search))
    );

    // ✨ เทคนิคสำคัญ: เรียงลำดับให้ "คนที่ถูกเลือก" ลอยขึ้นมาอยู่บนสุดเสมอ
    filtered.sort((a, b) => {
        const aSel = tempQuestDistSelection.has(a.id);
        const bSel = tempQuestDistSelection.has(b.id);
        if (aSel !== bSel) return bSel - aSel; // เลือกแล้ว (true) มาก่อน
        // ถ้าสถานะเหมือนกัน ให้เรียงตามห้อง -> เลขที่
        if ((a.class_name || '') !== (b.class_name || '')) return (a.class_name || '').localeCompare(b.class_name || '');
        return a.student_id.localeCompare(b.student_id, undefined, {numeric: true});
    });

    // อัปเดตตัวเลขจำนวนคนที่เลือก
    countEl.textContent = tempQuestDistSelection.size;

    // สร้าง HTML
    if (filtered.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-8 text-gray-400">ไม่พบนักเรียน</div>`;
        return;
    }

    container.innerHTML = filtered.map(s => {
        const isSelected = tempQuestDistSelection.has(s.id);
        // สไตล์การ์ด: ถ้าเลือกจะเป็นสีเขียว ถ้าไม่เลือกเป็นสีขาว
        const cardClass = isSelected 
            ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500' 
            : 'bg-white border-gray-200 hover:border-indigo-300';

        return `
        <div onclick="toggleQuestDistSelection('${s.id}')" class="cursor-pointer p-3 rounded-lg border flex items-center gap-3 transition-all select-none ${cardClass}">
            <div class="w-6 h-6 rounded flex items-center justify-center border transition-colors shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-300 text-transparent'}">
                ✓
            </div>
            <div class="min-w-0">
                <p class="font-bold text-gray-800 text-sm truncate">${s.full_name}</p>
                <p class="text-xs text-gray-500">เลขที่ ${s.student_id} | ห้อง ${s.class_name}</p>
            </div>
        </div>`;
    }).join('');
};

// 3. ฟังก์ชันสลับการเลือก (Toggle)
window.toggleQuestDistSelection = (sid) => {
    if (tempQuestDistSelection.has(sid)) {
        tempQuestDistSelection.delete(sid);
    } else {
        tempQuestDistSelection.add(sid);
    }
    renderQuestStudentSelector(); // วาดใหม่ทันทีเพื่อให้ UI อัปเดต
};

// 4. ปุ่มล้างการเลือกทั้งหมด
window.clearQuestDistSelection = () => {
    tempQuestDistSelection.clear();
    renderQuestStudentSelector();
};

// 5. ปรับจำนวนครั้ง (+/-)
window.adjustQuestDistQty = (delta) => {
    const input = document.getElementById('quest-dist-qty');
    let val = parseInt(input.value) || 1;
    val += delta;
    if (val < 1) val = 1;
    input.value = val;
};

window.confirmQuestDistribution = async () => {
    if (tempQuestDistSelection.size === 0) return alert('กรุณาเลือกนักเรียนอย่างน้อย 1 คนครับ');
    
    const quest = quests.find(q => q.id === currentQuestDistId);
    if (!quest) return;

    const qty = parseInt(document.getElementById('quest-dist-qty').value) || 1;
    const baseTotalPoints = quest.points * qty; // แต้มตั้งต้น

    document.getElementById('quest-distribution-modal').classList.add('hidden');
    showToast('กำลังแจกแต้ม... ⏳');

    const batch = writeBatch(db);
    const timestamp = serverTimestamp();
    let count = 0;

    tempQuestDistSelection.forEach(sid => {
        const s = students.find(std => std.id === sid);
        if (s) {
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
            const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

            // 🔥 เรียกใช้ฟังก์ชันคำนวณบัฟตรงนี้เช่นกัน!
            const { totalPoints, bonusPoints, bonusPercent } = calculateQuestPointsWithBuffs(s, baseTotalPoints);
            
           
            let historyAction = `ภารกิจสำเร็จ: ${quest.title} (x${qty})`;
            if (bonusPoints > 0) {
                historyAction += ` [Buff +${bonusPercent}%]`;
            }

            if ((s.warning_cards || 0) > 0) {
                batch.update(sRef, { pending_points: increment(totalPoints) });
            } else {
                batch.update(sRef, { points: increment(totalPoints) });
            }

            batch.set(hRef, {
                student_id: s.id,
                student_name: s.full_name,
                action: historyAction,
                amount: totalPoints,
                type: 'quest_complete',
                timestamp: timestamp
            });
            count++;
        }
    });

    try {
        await batch.commit();
        showToast(`✅ แจกแต้มสำเร็จ ${count} คน`);
        if(window.soundCoin) window.soundCoin.play();
        tempQuestDistSelection.clear();
        currentQuestDistId = null;
    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

// ==========================================
// 📝 AUTO QUIZ GRADER SYSTEM
// ==========================================

let quizData = []; // เก็บข้อมูลที่อ่านจาก CSV
let quizQuestions = []; // เก็บรายการคำถาม

window.showQuizModal = () => {
    resetQuizModal();
    document.getElementById('quiz-modal').classList.remove('hidden');
    document.getElementById('quiz-modal').classList.add('flex');
};

window.resetQuizModal = () => {
    document.getElementById('quiz-step-1').classList.remove('hidden');
    document.getElementById('quiz-step-2').classList.add('hidden');
    document.getElementById('quiz-step-3').classList.add('hidden');
    document.getElementById('quiz-file-input').value = '';
    quizData = [];
    quizQuestions = [];
};

// ✅ ฟังก์ชันอ่านไฟล์ (รองรับทั้ง CSV และ XLSX)
window.handleQuizFile = (input) => {
    const file = input.files[0];
    if (!file) return;

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    const reader = new FileReader();

    // กรณีเป็น Excel (XLSX/XLS)
    if (isExcel) {
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // แปลงข้อมูลใน Sheet เป็น Array of Arrays (แถว 1, แถว 2, ...)
            const rows = XLSX.utils.sheet_to_json(worksheet, {header: 1});
            processQuizData(rows); // ส่งไปคำนวณ
        };
        reader.readAsArrayBuffer(file);
    } 
    // กรณีเป็น CSV (แบบเดิม)
    else {
        reader.onload = (e) => {
            const text = e.target.result;
            // แปลง Text เป็น Array of Arrays
            const rows = text.split('\n').map(l => {
                // Regex ตัด CSV แบบบ้านๆ (รองรับ comma ใน quote)
                return l.trim() ? l.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(s => s.replace(/^"|"$/g, '').trim()) : [];
            }).filter(r => r.length > 0);
            
            processQuizData(rows); // ส่งไปคำนวณ
        };
        reader.readAsText(file);
    }
};

// ✅ ฟังก์ชันประมวลผลข้อมูล (แยกออกมาเพื่อให้ใช้ร่วมกันได้)
function processQuizData(rows) {
    // จากไฟล์ตัวอย่าง:
    // แถว 0-2: Metadata (ข้าม)
    // แถว 3: Header (Index เริ่มที่ 0) -> ตรงกับบรรทัดที่ 4 ใน Excel
    // แถว 4+: Data
    
    if (rows.length < 5) return alert('ไฟล์ข้อมูลน้อยเกินไป หรือรูปแบบไม่ถูกต้อง');

    const headers = rows[3]; // หัวข้อคำถาม
    
    // หา Index คำถาม (คอลัมน์ที่ 4 เป็นต้นไป คือ Index 3)
    // โครงสร้างไฟล์: [ชื่อ, ห้อง, จำนวน, คำถาม1, คำถาม2...]
    const questionStartIndex = 3; 
    
    quizQuestions = [];
    // วนลูปหาหัวข้อคำถามตั้งแตคอลัมน์ที่ 4
    for (let i = questionStartIndex; i < headers.length; i++) {
        if (headers[i]) { // ถ้ามีหัวข้อ
            quizQuestions.push({
                id: i,
                text: headers[i],
                colIndex: i,
                correctAnswer: '',
                points: 10
            });
        }
    }

    // ดึงข้อมูลนักเรียน
    quizData = rows.slice(4).map(cols => {
        // ป้องกันแถวว่าง
        if (!cols || cols.length === 0 || !cols[0]) return null;

        const name = cols[0]; // ชื่อ (คอลัมน์แรก)
        const answers = {};
        
        quizQuestions.forEach(q => {
            // ดึงคำตอบจากคอลัมน์ที่ตรงกัน
            answers[q.id] = cols[q.colIndex] || ''; 
        });

        const student = students.find(s => s.full_name.trim() === name.trim());
        
        return {
            name: name,
            studentId: student ? student.id : null,
            answers: answers
        };
    }).filter(item => item !== null); // กรองแถวว่างทิ้ง

    renderQuizConfig(); // ไปหน้าตั้งค่าเฉลย
}

function renderQuizConfig() {
    // เปลี่ยนหน้า UI
    document.getElementById('quiz-step-1').classList.add('hidden');
    document.getElementById('quiz-step-2').classList.remove('hidden');

    const matchedCount = quizData.filter(d => d.studentId).length;
    document.getElementById('quiz-student-count').textContent = `${matchedCount} / ${quizData.length}`;
    
    // ลองเดารหัสกิจกรรมจากชื่อไฟล์ (เช่น "ครั้งที่ 8" -> "quiz_8")
    // quizFilename เก็บชื่อไฟล์ตอน upload (ต้องประกาศตัวแปร global เพิ่มถ้ายังไม่มี หรือใช้ค่า default)
    let defaultTag = 'quiz_' + new Date().toISOString().slice(0,10); 
    // ถ้าท่านอยากให้ฉลาดขึ้น สามารถดึงจากชื่อไฟล์ใน handleQuizFile ได้ (แต่เอาแบบง่ายก่อนคือให้ครูกรอกเอง)

    // 🔥 ส่วนที่เพิ่ม: กล่องตั้งค่าโบนัส + รหัสกิจกรรม (Activity Tag)
    const configHtml = `
        <div class="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-yellow-50 p-3 rounded-lg border border-yellow-200 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="text-2xl">🏆</span>
                    <div>
                        <h4 class="font-bold text-yellow-800 text-sm">โบนัสตอบถูกหมด</h4>
                        <p class="text-xs text-yellow-600">บวกเพิ่มเมื่อ Perfect</p>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <input type="number" id="quiz-bonus-points" value="0" min="0" class="w-16 text-center border border-yellow-300 rounded px-1 py-1 font-bold text-yellow-700 outline-none">
                    <span class="text-xs font-bold text-gray-500">แต้ม</span>
                </div>
            </div>

            <div class="bg-indigo-50 p-3 rounded-lg border border-indigo-200 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="text-2xl">🏷️</span>
                    <div>
                        <h4 class="font-bold text-indigo-800 text-sm">รหัสกิจกรรมนี้ (Tag)</h4>
                        <p class="text-xs text-indigo-600">ใช้เช็คว่าใครเคยรับไปแล้ว</p>
                    </div>
                </div>
                <div>
                    <input type="text" id="quiz-activity-tag" value="${defaultTag}" class="w-28 text-center border border-indigo-300 rounded px-2 py-1 font-bold text-indigo-700 outline-none text-sm" placeholder="เช่น quiz_8">
                </div>
            </div>
        </div>
    `;

    const listContainer = document.querySelector('#quiz-step-2 .overflow-y-auto'); 
    
    // สร้างตาราง
    const tableHtml = `
        <table class="w-full text-sm">
            <thead class="bg-gray-100 text-gray-700 sticky top-0 shadow-sm">
                <tr>
                    <th class="px-4 py-2 text-left w-1/3">คำถาม</th>
                    <th class="px-4 py-2 text-left w-1/3">เฉลยคำตอบ</th>
                    <th class="px-4 py-2 text-center w-24">คะแนน</th>
                </tr>
            </thead>
            <tbody id="quiz-config-list" class="divide-y divide-gray-100">
                ${quizQuestions.map(q => `
                    <tr class="bg-white hover:bg-gray-50">
                        <td class="px-4 py-3 align-top">
                            <div class="text-sm font-bold text-gray-800">${q.text}</div>
                        </td>
                        <td class="px-4 py-3 align-top">
                            <input type="text" class="quiz-ans-input w-full border border-blue-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-blue-700 font-bold" 
                                data-qid="${q.id}" placeholder="คำตอบ...">
                        </td>
                        <td class="px-4 py-3 align-top">
                            <input type="number" class="quiz-score-input w-full border border-gray-300 rounded px-2 py-2 text-center font-bold text-green-600" 
                                data-qid="${q.id}" value="${q.points}">
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    const step2Div = document.getElementById('quiz-step-2');
    const header = step2Div.children[0].outerHTML;
    const footer = step2Div.children[step2Div.children.length - 1].outerHTML;
    
    step2Div.innerHTML = `
        ${header}
        ${configHtml}
        <div class="flex-1 overflow-y-auto custom-scrollbar border rounded-lg">
            ${tableHtml}
        </div>
        ${footer}
    `;
}

window.previewQuizCalculation = () => {
    const ansInputs = document.querySelectorAll('.quiz-ans-input');
    const bonusPoints = parseInt(document.getElementById('quiz-bonus-points').value) || 0;
    const activityTag = document.getElementById('quiz-activity-tag').value.trim();

    if (!activityTag) return alert('กรุณาระบุรหัสกิจกรรม (Tag) เพื่อป้องกันการแจกซ้ำครับ');

    let hasAnswer = false;
    let totalQuestionsWithAnswer = 0;

    ansInputs.forEach(input => {
        const qid = input.dataset.qid;
        const correct = input.value.trim();
        const points = parseInt(document.querySelector(`.quiz-score-input[data-qid="${qid}"]`).value) || 0;
        
        const q = quizQuestions.find(x => x.id == qid);
        if (q) {
            q.correctAnswer = correct;
            q.points = points;
            if(correct) {
                hasAnswer = true;
                totalQuestionsWithAnswer++;
            }
        }
    });

    if (!hasAnswer) return alert('กรุณากรอกเฉลยอย่างน้อย 1 ข้อครับ');

    const previewList = document.getElementById('quiz-preview-list');
    let html = '';
    let newRecipientCount = 0;

    const validStudents = quizData.filter(d => d.studentId);
    
    if (validStudents.length === 0) {
        html = `<tr><td colspan="4" class="text-center py-4 text-red-500">ไม่พบชื่อนักเรียนที่ตรงกันเลย</td></tr>`;
    } else {
        validStudents.forEach(d => {
            const s = students.find(x => x.id === d.studentId);
            const alreadyReceived = s.completed_activities && s.completed_activities.includes(activityTag);

            let correctCount = 0;
            let totalScore = 0;
            let isPerfect = false;

            quizQuestions.forEach(q => {
                if (q.correctAnswer) {
                    const studentAns = String(d.answers[q.id] || "").trim().toLowerCase();
                    const teacherAns = String(q.correctAnswer).trim().toLowerCase();
                    if (studentAns && studentAns === teacherAns) {
                        correctCount++;
                        totalScore += q.points;
                    }
                }
            });
            
            if (correctCount === totalQuestionsWithAnswer && totalQuestionsWithAnswer > 0) {
                isPerfect = true;
                totalScore += bonusPoints;
            }

            // 🔥 คำนวณบัฟ (เรียกใช้ฟังก์ชันที่มีอยู่แล้วในระบบ)
            const finalPoints = calculateBuffedPoints(s, totalScore);
            const isBoosted = finalPoints > totalScore;

            d.baseScore = totalScore;
            d.totalScore = finalPoints; // บันทึกยอดสุทธิหลัง Boost
            d.isPerfect = isPerfect;
            d.alreadyReceived = alreadyReceived;
            
            if (totalScore > 0 || alreadyReceived) {
                const rowClass = alreadyReceived ? 'bg-gray-100 text-gray-400' : 'bg-white border-b hover:bg-gray-50';
                
                let scoreHtml = '';
                if (alreadyReceived) {
                    scoreHtml = '<span class="text-gray-400 font-bold">รับแล้ว</span>';
                } else {
                    // ถ้ามีการ Boost ให้โชว์เลขเดิมขีดฆ่า แล้วโชว์เลขใหม่
                    if (isBoosted) {
                        scoreHtml = `
                            <div class="flex flex-col items-center leading-none">
                                <span class="text-green-600 font-bold text-lg">+${finalPoints}</span>
                                <span class="text-[10px] text-gray-400 line-through">(${totalScore})</span>
                                <span class="text-[9px] text-blue-500 font-bold">🚀 Boosted</span>
                            </div>`;
                    } else {
                        scoreHtml = `<span class="text-green-600 font-bold">+${finalPoints}</span>`;
                    }
                    newRecipientCount++;
                }

                html += `
                <tr class="${rowClass}">
                    <td class="px-4 py-2 font-medium">
                        <div class="flex items-center gap-2">
                            ${d.name}
                            ${isPerfect && !alreadyReceived ? '<span class="text-[9px] bg-yellow-100 text-yellow-700 px-1 rounded border border-yellow-200">🏆 Perfect</span>' : ''}
                            ${alreadyReceived ? '<span class="text-[9px] bg-gray-200 text-gray-500 px-1 rounded">✅ เคยรับ</span>' : ''}
                        </div>
                    </td>
                    <td class="px-4 py-2 text-center text-sm">${correctCount} / ${totalQuestionsWithAnswer}</td>
                    <td class="px-4 py-2 text-center">${scoreHtml}</td>
                </tr>`;
            }
        });
    }

    previewList.innerHTML = html || `<tr><td colspan="3" class="text-center py-4 text-gray-400">ไม่มีใครได้คะแนนเพิ่ม</td></tr>`;
    
    const confirmBtn = document.querySelector('#quiz-step-3 button.bg-green-600');
    if(confirmBtn) confirmBtn.textContent = `✅ ยืนยันแจกแต้ม (${newRecipientCount} คนใหม่)`;

    document.getElementById('quiz-step-2').classList.add('hidden');
    document.getElementById('quiz-step-3').classList.remove('hidden');
};

window.confirmQuizDistribution = async () => {
    const activityTag = document.getElementById('quiz-activity-tag').value.trim();
    if (!confirm(`ยืนยันการแจกแต้มสำหรับกิจกรรม "${activityTag}" ?\n(เฉพาะคนที่ยังไม่เคยได้รับ)`)) return;

    let quizContributors = {};

    const batch = writeBatch(db);
    const timestamp = serverTimestamp();
    let count = 0;

    // วนลูปข้อมูล (ใช้ for...of เพื่อความชัวร์)
    for (const d of quizData) {
        // เงื่อนไข: มี ID + มีแต้ม (Base Score > 0) + ยังไม่เคยรับ
        if (d.studentId && d.baseScore > 0 && !d.alreadyReceived) {
            const s = students.find(x => x.id === d.studentId);
            if (s) {
                const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
                const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

                // 🔥 คำนวณบัฟอีกครั้งเพื่อความชัวร์ (หรือจะใช้ค่า d.totalScore ที่คำนวณไว้จากหน้า Preview ก็ได้)
                // แต่เรียกใหม่ชัวร์สุด เผื่อมีการแก้ข้อมูลระหว่างทาง
                const finalPoints = calculateBuffedPoints(s, d.baseScore);
                
                const updates = {};
                
                if ((s.warning_cards || 0) > 0) {
                    updates.pending_points = increment(finalPoints);
                } else {
                    updates.points = increment(finalPoints);
                }

                updates.completed_activities = arrayUnion(activityTag);

                batch.update(sRef, updates);

                // สร้าง Log
                let logReason = d.isPerfect ? `Perfect (ฐาน: ${d.baseScore})` : `คะแนนดิบ: ${d.baseScore}`;
                if (finalPoints > d.baseScore) {
                     logReason += ` + Boosted 🚀`;
                }
                if (finalPoints > 0) {
                    quizContributors[s.id] = finalPoints;
                }

                batch.set(hRef, {
                    student_id: s.id,
                    student_name: s.full_name,
                    action: `ตอบคำถาม (${activityTag})`,
                    amount: finalPoints, // ยอดสุทธิ
                    type: 'add_points',
                    timestamp: timestamp,
                    reason: logReason
                });
                count++;
            }
        }
    }

    if (count > 0) {
        try {
            await batch.commit();
            if (Object.keys(quizContributors).length > 0) {
                await autoDamageBoss(quizContributors);
            }
            showToast(`✅ แจกแต้มสำเร็จ ${count} คน`);
            if(window.soundCoin) window.soundCoin.play();
            document.getElementById('quiz-modal').classList.add('hidden');
        } catch (e) {
            console.error(e);
            alert('เกิดข้อผิดพลาด: ' + e.message);
        }
    } else {
        alert('ไม่มีรายชื่อใหม่ที่ต้องแจกแต้ม');
    }
};

// ==========================================================
// 🏦 STUDENT BANK SYSTEM (ฝาก-ถอน ฝั่งนักเรียน)
// ==========================================================

let currentStudentBankAction = 'deposit'; // 'deposit' or 'withdraw'


// 1. เปิดหน้าต่างฝากถอน
window.openStudentBankModal = (action) => {

    if (currentStudentData.warning_cards && currentStudentData.warning_cards > 0) {
        // ถ้ามีใบเตือน ให้เด้ง Modal สีแดงขึ้นมาด่า (เอ้ย! แจ้งเตือน) แทน
        const frozenModal = document.getElementById('frozen-account-modal');
        if (frozenModal) {
            frozenModal.classList.remove('hidden');
            frozenModal.classList.add('flex');
        } else {
            alert('⛔ บัญชีถูกระงับเนื่องจากมีใบเตือน (Warning)');
        }
        return; // ❌ จบการทำงานทันที (ไม่เปิดหน้าฝากถอน)
    }
    currentStudentBankAction = action;
    const modal = document.getElementById('student-bank-modal');
    const title = document.getElementById('std-bank-title');
    const btn = document.getElementById('btn-confirm-std-bank');
    const input = document.getElementById('std-bank-amount');

    const principal = currentStudentData.bank_points || 0;
    const interest = calculatePendingInterest(currentStudentData); // คำนวณดอกเบี้ย
    const totalBankBalance = Math.floor(principal + interest); // รวมยอด

    // รีเฟรชยอดเงินล่าสุด
    document.getElementById('std-bank-wallet').textContent = Math.floor(currentStudentData.points).toLocaleString();
    document.getElementById('std-bank-balance').textContent = totalBankBalance.toLocaleString();
    input.value = '';

    if (action === 'deposit') {
        title.textContent = '📥 ฝากแต้มเข้าธนาคาร';
        title.className = 'text-2xl font-bold mb-1 text-green-600';
        btn.className = 'flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all';
        btn.textContent = 'ยืนยันการฝาก';
    } else {
        title.textContent = '📤 ถอนแต้มออกมาใช้';
        title.className = 'text-2xl font-bold mb-1 text-blue-600';
        btn.className = 'flex-1 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all';
        btn.textContent = 'ยืนยันการถอน';
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => input.focus(), 100);
};

// 2. ปุ่มลัดใส่ตัวเลข
window.setStudentBankAmount = (val) => {
    const input = document.getElementById('std-bank-amount');
    if (val === 'all') {
        // ถ้าฝาก -> หมดตัว, ถ้าถอน -> หมดธนาคาร
        if (currentStudentBankAction === 'deposit') {
            input.value = Math.floor(currentStudentData.points);
        } else {
            const principal = currentStudentData.bank_points || 0;
            const interest = calculatePendingInterest(currentStudentData);
            input.value = Math.floor(principal + interest);
        }
    } else {
        input.value = val;
    }
};

// ==========================================================
// 🏦 STUDENT BANK SYSTEM (ระบบธนาคารฝั่งนักเรียน - ฉบับปรับปรุง)
// ==========================================================

// ยืนยันทำรายการ (แก้ให้คิดดอกเบี้ยก่อน เหมือนครูทำให้)
window.confirmStudentBankTransaction = async () => {
    const amount = parseInt(document.getElementById('std-bank-amount').value);
    if (isNaN(amount) || amount <= 0) return alert('กรุณาระบุจำนวนแต้มให้ถูกต้อง');

    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', currentStudentData.id);
    const batch = writeBatch(db);
    const timestamp = serverTimestamp();

    // 1. 💰 คำนวณดอกเบี้ยที่ค้างอยู่ก่อน (เพื่อความยุติธรรม)
    const interest = calculatePendingInterest(currentStudentData); // ใช้ฟังก์ชันเดิมที่มีอยู่แล้ว
    const interestInt = Math.floor(interest);
    
    // ตัวแปรสำหรับเช็คเงินต้นรวมดอกเบี้ย
    const currentBankPoints = currentStudentData.bank_points || 0;
    const totalBankBalance = currentBankPoints + interestInt;

    // ถ้ามีดอกเบี้ย ให้บันทึกประวัติการรับดอกเบี้ยด้วย
    if (interestInt > 0) {
        const hRefInterest = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
        batch.set(hRefInterest, {
            student_id: currentStudentData.id,
            student_name: currentStudentData.full_name,
            action: `รับดอกเบี้ยอัตโนมัติ (ก่อนทำรายการ)`,
            amount: interestInt,
            type: 'bank_interest',
            timestamp: timestamp
        });
    }

    // 2. 🏦 ดำเนินการ ฝาก/ถอน
    if (currentStudentBankAction === 'deposit') {
        // --- ฝากเงิน ---
        if (currentStudentData.points < amount) return alert('แต้มในกระเป๋าไม่พอครับ');

        batch.update(sRef, {
            points: increment(-amount),
            bank_points: increment(amount + interestInt), // เอาดอกเบี้ยทบเข้าไปด้วยเลย
            bank_deposit_time: timestamp // ✅ รีเซ็ตเวลาใหม่ (ถูกต้อง)
        });

        // ประวัติฝาก
        const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
        batch.set(hRef, {
            student_id: currentStudentData.id,
            student_name: currentStudentData.full_name,
            action: 'ฝากแต้ม (นักเรียน)',
            amount: -amount,
            type: 'bank_deposit',
            timestamp: timestamp
        });

    } else {
        // --- ถอนเงิน ---
        // เช็คยอดเงินในบัญชี (รวมดอกเบี้ยแล้ว) ว่าพอถอนไหม
        if (totalBankBalance < amount) return alert('แต้มในธนาคารไม่พอถอนครับ');

        // คำนวณยอดคงเหลือหลังถอน
        // สูตร: (เงินต้นเก่า + ดอกเบี้ย) - ยอดถอน
        // เนื่องจาก Firestore increment ทำงานแบบบวกเพิ่ม เราต้องระวัง
        // เราใช้: increment(interestInt - amount)
        // ถ้า interestInt = 10, amount = 100 -> ผลคือ -90 (เงินหายไป 90) ถูกต้อง
        
        batch.update(sRef, {
            points: increment(amount),
            bank_points: increment(interestInt - amount), // ดอกเบี้ยเข้า ถอนออก
            bank_deposit_time: timestamp // ✅ รีเซ็ตเวลาใหม่ (ถูกต้อง)
        });

        // ประวัติถอน
        const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
        batch.set(hRef, {
            student_id: currentStudentData.id,
            student_name: currentStudentData.full_name,
            action: 'ถอนแต้ม (นักเรียน)',
            amount: amount,
            type: 'bank_withdraw',
            timestamp: timestamp
        });
    }

    try {
        await batch.commit();
        document.getElementById('student-bank-modal').classList.add('hidden');
        if(window.soundCoin) window.soundCoin.play();
        
        // แจ้งเตือนสวยๆ
        let msg = currentStudentBankAction === 'deposit' ? `ฝาก ${amount} แต้ม` : `ถอน ${amount} แต้ม`;
        if (interestInt > 0) msg += ` (และรับดอกเบี้ย ${interestInt} แต้ม)`;
        
        Swal.fire({
            icon: 'success',
            title: 'ทำรายการสำเร็จ',
            text: msg,
            timer: 2000,
            showConfirmButton: false
        });

    } catch (e) {
        console.error(e);
        alert('Error: ' + e.message);
    }
};

// ==========================================================
// 🛡️ STUDENT GUILD SYSTEM (ระบบกิลด์ฝั่งนักเรียน)
// ==========================================================

// ✅ อัปเดต: เพิ่มตารางจัดอันดับกิลด์ (Leaderboard)
window.renderStudentGuild = () => {
    const container = document.getElementById('content-student-guild');
    if (!container) return;

    const s = currentStudentData;
    
    // กรณีไม่มีกิลด์
    if (!s || !s.guild_id) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-64 text-center p-6 bg-white rounded-2xl shadow-sm border border-gray-200 mt-4">
                <div class="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center text-5xl mb-4 grayscale opacity-50">🛡️</div>
                <h2 class="text-xl font-bold text-gray-700">คุณยังไม่มีสังกัดกิลด์</h2>
                <p class="text-gray-500 text-sm mt-2">โปรดรอเชิญเข้ากิลด์ หรือสร้างกิลด์ใหม่</p>
            </div>`;
        return;
    }

    // 1. ดึงข้อมูลกิลด์ของฉัน
    const myGuild = guilds.find(x => x.id === s.guild_id);
    if (!myGuild) return;

    // 2. 🏆 คำนวณอันดับกิลด์ทั้งหมด (Guild Leaderboard)
    const guildRankings = guilds.map(g => {
        const gMembers = students.filter(st => st.guild_id === g.id);
        const gPoints = gMembers.reduce((sum, m) => sum + (m.points || 0), 0);
        return { 
            ...g, 
            totalPoints: gPoints, 
            memberCount: gMembers.length 
        };
    }).sort((a, b) => b.totalPoints - a.totalPoints);

    // หาอันดับของกิลด์เรา
    const myGuildRank = guildRankings.findIndex(x => x.id === s.guild_id) + 1;
    const myGuildStats = guildRankings.find(x => x.id === s.guild_id); // ใช้ค่าที่คำนวณแล้ว

    // สมาชิกในกิลด์เรา (เรียงตามแต้ม)
    const myMembers = students
        .filter(st => st.guild_id === s.guild_id)
        .sort((a, b) => b.points - a.points);

    // เช็คบัฟ
    const activeBuffs = getGuildActiveBuffs(s.guild_id);

    const ruleCooldown = parseInt(myGuild.rule_cooldown) || 0;
    const ruleFee = parseInt(myGuild.rule_fee) || 0;
    
    let contractStatusHtml = ''; // ตัวแปรนี้จะเก็บ HTML กล่องสถานะ
    
    if (ruleCooldown > 0) {
        // 1. คำนวณเวลาที่ผ่านไป
        let joinedTime = 0;
        if (s.guild_joined_at) {
            // แปลง Timestamp ให้เป็น Milliseconds
            if (typeof s.guild_joined_at.toMillis === 'function') joinedTime = s.guild_joined_at.toMillis();
            else if (s.guild_joined_at instanceof Date) joinedTime = s.guild_joined_at.getTime();
            else if (s.guild_joined_at.seconds) joinedTime = s.guild_joined_at.seconds * 1000;
        }

        const now = Date.now();
        const timePassedMs = now - joinedTime;
        const cooldownMs = ruleCooldown * 60 * 60 * 1000;
        const remainingMs = cooldownMs - timePassedMs;
        
        if (remainingMs > 0) {
            // 🔴 กรณี: ยังติดสัญญา
            const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
            contractStatusHtml = `
                <div class="bg-red-50 p-4 rounded-xl border border-red-100 text-center relative overflow-hidden h-full flex flex-col justify-center">
                    <div class="absolute top-0 right-0 w-12 h-12 bg-red-100 rounded-full -mr-6 -mt-6 opacity-50"></div>
                    <p class="text-xs text-red-500 font-bold uppercase tracking-wider mb-1">⏳ ติดสัญญา</p>
                    <p class="text-xl font-black text-red-700">${remainingHours} ชม.</p>
                    <p class="text-[10px] text-red-300 mt-1">จากเงื่อนไข ${ruleCooldown} ชม.</p>
                </div>`;
        } else {
            // 🟢 กรณี: หมดสัญญาแล้ว (แสดงข้อความพิเศษ)
            contractStatusHtml = `
                <div class="bg-green-50 p-4 rounded-xl border border-green-100 text-center relative overflow-hidden h-full flex flex-col justify-center">
                    <div class="absolute top-0 right-0 w-12 h-12 bg-green-100 rounded-full -mr-6 -mt-6 opacity-50"></div>
                    <p class="text-xs text-green-500 font-bold uppercase tracking-wider mb-1">✅ สถานะ</p>
                    <p class="text-xl font-black text-green-600">สิ้นสุดสัญญา</p>
                    <p class="text-[10px] text-green-400 mt-1">ย้ายออกได้อิสระ</p>
                </div>`;
        }
    } else {
        // ⚪ กรณี: ไม่มีสัญญา (กิลด์อิสระ)
        contractStatusHtml = `
            <div class="bg-gray-50 p-4 rounded-xl border border-gray-100 text-center relative overflow-hidden h-full flex flex-col justify-center">
                 <p class="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">🕊️ สัญญาอิสระ</p>
                 <p class="text-[10px] text-gray-300 mt-1">ไม่มีเงื่อนไขผูกมัด</p>
            </div>`;
    }

    // HTML Template
    container.innerHTML = `
        <div class="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl shadow-lg p-6 text-white relative overflow-hidden mb-6">
            <div class="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-2xl"></div>
            
            <div class="flex flex-col md:flex-row items-center md:items-start gap-6 relative z-10">
                <div class="w-24 h-24 bg-white/20 rounded-2xl flex items-center justify-center text-6xl backdrop-blur-sm shadow-inner border border-white/30 shrink-0">
                    ${myGuild.icon || '🛡️'}
                </div>
                <div class="text-center md:text-left flex-1">
                    <div class="flex items-center justify-center md:justify-start gap-2 mb-1">
                        <span class="bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-0.5 rounded shadow-sm">
                            อันดับ #${myGuildRank}
                        </span>
                        <h2 class="text-3xl font-bold">${myGuild.name}</h2>${contractStatusHtml}
                    </div>
                    <p class="text-indigo-100 text-sm mb-4 opacity-90">"${myGuild.desc || 'ไม่มีคำอธิบาย'}"</p>
                    
                    <div class="flex flex-wrap justify-center md:justify-start gap-3 text-sm font-medium">
                        <div class="bg-white/20 px-3 py-1.5 rounded-lg flex items-center gap-2 backdrop-blur-sm">
                            👥 สมาชิก ${myGuildStats.memberCount} คน
                        </div>
                        <div class="bg-white/20 px-3 py-1.5 rounded-lg flex items-center gap-2 backdrop-blur-sm">
                            🏆 แต้มรวม ${Math.floor(myGuildStats.totalPoints).toLocaleString()}
                        </div>
                        <div class="bg-white/20 px-3 py-1.5 rounded-lg flex items-center gap-2 backdrop-blur-sm">
                            💸 ค่าปรับฉีกสัญญา ${(parseInt(myGuild.rule_fee) || 0).toLocaleString()} แต้ม
                        </div>
                        <div class="bg-indigo-800/40 px-3 py-1.5 rounded-lg border border-indigo-400/30 backdrop-blur-sm shadow-sm">
                            <div class="text-xl font-bold text-amber-300 leading-none flex items-center justify-end gap-1">
                                ${Math.floor(myGuild.fund_points || 0).toLocaleString()} 
                                <span class="text-sm">💵</span>
                            </div>
                            <div class="text-indigo-100 text-[10px] mt-0.5">กองทุนกลาง (แต้ม)</div>
                        </div>
                        
                    </div>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div class="bg-white p-4 rounded-xl shadow-sm border border-green-100 flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-xl">📈</div>
                <div>
                    <p class="text-xs text-gray-500 font-bold uppercase">ดอกเบี้ยธนาคาร</p>
                    <p class="text-lg font-bold text-green-600">+${(parseFloat(activeBuffs.interest) || 0).toFixed(2)}%</p>
                </div>
            </div>
            <div class="bg-white p-4 rounded-xl shadow-sm border border-red-100 flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-xl">🏷️</div>
                <div>
                    <p class="text-xs text-gray-500 font-bold uppercase">ส่วนลดร้านค้า</p>
                    <p class="text-lg font-bold text-red-600">-${activeBuffs.discount || 0}%</p>
                </div>
            </div>
            <div class="bg-white p-4 rounded-xl shadow-sm border border-blue-100 flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-xl">🚀</div>
                <div>
                    <p class="text-xs text-gray-500 font-bold uppercase">บูสต์แต้มภารกิจ</p>
                    <p class="text-lg font-bold text-blue-600">+${activeBuffs.point_boost || 0}%</p>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[500px]">
                <div class="p-4 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center shrink-0">
                    <h3 class="font-bold text-indigo-800 flex items-center gap-2">
                        🏰 สมาชิกกิลด์เรา
                    </h3>
                    <span class="text-xs text-indigo-500 bg-white px-2 py-1 rounded-full border border-indigo-100">
                        รวม ${myMembers.length} คน
                    </span>
                </div>
                <div class="overflow-y-auto custom-scrollbar flex-1 p-0">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-50 text-gray-500 border-b sticky top-0">
                            <tr>
                                <th class="px-4 py-2 text-center w-10">#</th>
                                <th class="px-4 py-2 text-left">ชื่อ</th>
                                <th class="px-4 py-2 text-right">แต้ม</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            ${myMembers.map((m, index) => `
                                <tr class="${m.id === s.id ? 'bg-indigo-50' : 'hover:bg-gray-50'} transition-colors">
                                    <td class="px-4 py-3 text-center font-mono text-gray-400 text-xs">${index + 1}</td>
                                    <td class="px-4 py-3">
                                        <div class="flex items-center gap-2">
                                            <span class="font-medium ${m.id === s.id ? 'text-indigo-700 font-bold' : 'text-gray-700'}">
                                                ${m.full_name}
                                            </span>
                                            ${m.id === s.id ? '<span class="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 rounded-full">ฉัน</span>' : ''}
                                            ${index === 0 ? '👑' : ''}
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 text-right font-bold text-gray-600">
                                        ${Math.floor(m.points).toLocaleString()}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[500px]">
                <div class="p-4 bg-yellow-50 border-b border-yellow-100 flex justify-between items-center shrink-0">
                    <h3 class="font-bold text-yellow-800 flex items-center gap-2">
                        🏆 อันดับกิลด์ทั้งหมด
                    </h3>
                </div>
                <div class="overflow-y-auto custom-scrollbar flex-1 p-0">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-50 text-gray-500 border-b sticky top-0">
                            <tr>
                                <th class="px-4 py-2 text-center w-12">#</th>
                                <th class="px-4 py-2 text-left">กิลด์</th>
                                <th class="px-4 py-2 text-right">แต้มรวม</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            ${guildRankings.map((g, index) => {
                                const isMyGuild = g.id === s.guild_id;
                                let rankColor = 'bg-gray-100 text-gray-500'; // Default
                                if(index === 0) rankColor = 'bg-yellow-100 text-yellow-700'; // ที่ 1
                                else if(index === 1) rankColor = 'bg-gray-200 text-gray-600'; // ที่ 2
                                else if(index === 2) rankColor = 'bg-orange-100 text-orange-700'; // ที่ 3

                                return `
                                <tr class="${isMyGuild ? 'bg-yellow-50/50 border-l-4 border-l-yellow-400' : 'hover:bg-gray-50'} transition-colors">
                                    <td class="px-4 py-3 text-center">
                                        <span class="inline-block w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold ${rankColor}">
                                            ${index + 1}
                                        </span>
                                    </td>
                                    <td class="px-4 py-3">
                                        <div class="flex items-center gap-3">
                                            <div class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-lg shadow-sm border border-gray-200">
                                                ${g.icon || '🛡️'}
                                            </div>
                                            <div>
                                                <div class="font-bold ${isMyGuild ? 'text-yellow-900' : 'text-gray-700'}">
                                                    ${g.name}
                                                </div>
                                                <div class="text-xs text-gray-400">สมาชิก ${g.memberCount} คน</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <span class="font-bold text-indigo-600 text-lg">
                                            ${Math.floor(g.totalPoints).toLocaleString()}
                                        </span>
                                    </td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    `;
};

// 📂 app.js

window.saveAnnouncement = async () => {
    const msg = document.getElementById('setting-announcement-input').value.trim();
    
    try {
        const batch = writeBatch(db);
        
        // ✅ แก้ไข: ใช้ collections.config() เพื่ออ้างอิง Path ที่ถูกต้อง (มี 'data' คั่น)
        // ผลลัพธ์จะเป็น: artifacts/appId/public/data/config/school_settings (6 ส่วน = ถูกต้อง)
        const configRef = doc(collections.config(), 'school_settings');
        
        // บันทึกข้อความและเวลา
        batch.set(configRef, { 
            announcement_msg: msg,
            announcement_time: serverTimestamp() 
        }, { merge: true });

        await batch.commit();
        showToast(msg ? '✅ ส่งประกาศเรียบร้อย!' : '🗑️ ลบประกาศแล้ว');
        
    } catch (e) {
        console.error(e);
        alert('Error: ' + e.message);
    }
};

// ==========================================
// 📈 ระบบตลาดหุ้น (Stock Market System)
// ==========================================
let stocks = [];
let currentTradeStock = null;
let currentTradeMode = 'buy'; // 'buy' or 'sell'
const MARKET_FEE_PERCENT = 0.03; // ค่าธรรมเนียม 3%

// Subscribe ข้อมูลหุ้น (ใส่ใน initSystem หรือ subscribeToData)
function subscribeToStocks() {
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'stocks'), orderBy('symbol'));
    onSnapshot(q, (snapshot) => {
        stocks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // ถ้าอยู่ในหน้าหุ้น ให้รีเฟรชหน้าจอ
        if (document.getElementById('content-stocks').classList.contains('hidden') === false) {
            renderStockMarket();
        }
        // ถ้าเป็นครู ให้รีเฟรชตารางคุม
        if (userRole === 'teacher') {
            renderTeacherStockControl();
        }
    });
}
// อย่าลืมเรียก subscribeToStocks() ใน initSystem() ด้วยนะครับ!

window.renderStockMarket = () => {
    const list = document.getElementById('stock-market-list');
    if (!list) return;
    
    // คำนวณพอร์ต
    const myPortfolio = currentStudentData.portfolio || [];
    let totalPortfolioValue = 0;
    
    // 1. วาดการ์ดหุ้น
    list.innerHTML = stocks.map(stock => {
        const holding = myPortfolio.find(p => p.symbol === stock.symbol);
        const holdAmount = holding ? holding.amount : 0;
        const currentVal = holdAmount * stock.price;
        totalPortfolioValue += currentVal;

        // คำนวณการเปลี่ยนแปลงราคา
        const change = stock.price - (stock.prev_price || stock.price);
        const changePercent = stock.prev_price ? (change / stock.prev_price) * 100 : 0;
        const colorClass = change >= 0 ? 'text-green-500' : 'text-red-500';
        const sign = change >= 0 ? '+' : '';
       

        return `
        <div onclick="openTradeModal('${stock.id}')" class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer group relative overflow-hidden">
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-2xl border border-gray-200">
                        ${stock.icon || '📈'}
                    </div>
                    <div>
                        <div class="font-bold text-gray-800 text-lg leading-tight">${stock.symbol}</div>
                        <div class="text-xs text-gray-500">${stock.name}</div>
                    </div>
                </div>
                <div class="text-right">
                    <div class="font-bold text-xl text-slate-800">${Math.floor(stock.price)}</div>
                    <div class="text-xs font-bold ${colorClass}">${sign}${Math.floor(change)} (${sign}${(changePercent).toFixed(1)}%)</div>
                </div>
            </div>
            
            ${holdAmount > 0 ? `
            <div class="mt-2 pt-2 border-t border-gray-50 flex justify-between items-center text-sm">
                <span class="text-gray-500">ถือครอง:</span>
                <span class="font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">${holdAmount} หุ้น</span>
            </div>
            ` : ''}

            <div class="mt-3 text-center">
                <span class="text-xs font-bold text-indigo-500 bg-indigo-50 px-3 py-1 rounded-full group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    🛒 กดเพื่อซื้อ/ขาย
                </span>
            </div>
            
            <div class="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
        </div>
    
        `;
    }).join('');

    // 2. อัปเดตสรุปพอร์ตด้านบน
    document.getElementById('stock-cash-balance').textContent = Math.floor(currentStudentData.points).toLocaleString();
    document.getElementById('portfolio-total-value').textContent = Math.floor(totalPortfolioValue).toLocaleString();
    
    const holdingCount = myPortfolio.filter(p => p.amount > 0).length;
    document.getElementById('stock-count-hold').textContent = `${holdingCount} รายการ`;
    
    // คำนวณ P/L รวม (กำไร/ขาดทุน)
    // (ต้องเก็บต้นทุนเฉลี่ยไว้ใน Portfolio ถึงจะคำนวณแม่นยำ แต่นี่เอาแบบคร่าวๆ ไปก่อน)
};

window.openTradeModal = (stockId) => {
    currentTradeStock = stocks.find(s => s.id === stockId);
    if (!currentTradeStock) return;

    document.getElementById('trade-stock-name').textContent = `${currentTradeStock.symbol} - ${currentTradeStock.name}`;
    document.getElementById('trade-stock-icon').textContent = currentTradeStock.icon || '📈';
    document.getElementById('trade-stock-price').textContent = Math.floor(currentTradeStock.price);

    const descEl = document.getElementById('trade-stock-desc');
    if (descEl) {
        descEl.textContent = currentTradeStock.description || 'ไม่มีข้อมูลบริษัท';
    }
    
    // Reset Modal
    document.getElementById('trade-qty').value = 1;
    setTradeMode('buy'); // Default buy
    
    document.getElementById('stock-trade-modal').classList.remove('hidden');
    document.getElementById('stock-trade-modal').classList.add('flex');
    calculateTradeTotal();
};

window.closeTradeModal = () => {
    document.getElementById('stock-trade-modal').classList.add('hidden');
    document.getElementById('stock-trade-modal').classList.remove('flex');
};

window.setTradeMode = (mode) => {
    currentTradeMode = mode;
    const btnBuy = document.getElementById('btn-mode-buy');
    const btnSell = document.getElementById('btn-mode-sell');
    const btnConfirm = document.getElementById('btn-trade-confirm');
    
    if (mode === 'buy') {
        btnBuy.className = "flex-1 py-2 rounded-lg font-bold text-sm transition-all bg-white shadow text-green-600";
        btnSell.className = "flex-1 py-2 rounded-lg font-bold text-sm transition-all text-gray-500 hover:text-red-600";
        btnConfirm.className = "w-full py-3 rounded-xl font-bold text-white bg-green-500 hover:bg-green-600 shadow-lg shadow-green-200";
        btnConfirm.textContent = "ยืนยันการซื้อ (Buy)";
        
        // Max Buy
        const max = Math.floor(currentStudentData.points / (currentTradeStock.price * (1 + MARKET_FEE_PERCENT)));
        document.getElementById('trade-max-label').textContent = `ซื้อได้สูงสุด: ${max}`;
    } else {
        btnBuy.className = "flex-1 py-2 rounded-lg font-bold text-sm transition-all text-gray-500 hover:text-green-600";
        btnSell.className = "flex-1 py-2 rounded-lg font-bold text-sm transition-all bg-white shadow text-red-600";
        btnConfirm.className = "w-full py-3 rounded-xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-200";
        btnConfirm.textContent = "ยืนยันการขาย (Sell)";

        // Max Sell
        const holding = (currentStudentData.portfolio || []).find(p => p.symbol === currentTradeStock.symbol);
        const max = holding ? holding.amount : 0;
        document.getElementById('trade-max-label').textContent = `ขายได้สูงสุด: ${max}`;
    }
    calculateTradeTotal();
};

window.adjustTradeQty = (delta) => {
    const input = document.getElementById('trade-qty');
    let val = parseInt(input.value) + delta;
    if (val < 1) val = 1;
    input.value = val;
    calculateTradeTotal();
};

window.calculateTradeTotal = () => {
    const qty = parseInt(document.getElementById('trade-qty').value) || 0;
    const price = Math.floor(currentTradeStock.price);
    const rawTotal = qty * price;
    
    // คิดค่าธรรมเนียมเฉพาะตอนซื้อ (หรือขายด้วยแล้วแต่กติกา) -> อันนี้เอาแบบมาตรฐาน: ซื้อเสีย/ขายเสีย
    const fee = Math.ceil(rawTotal * MARKET_FEE_PERCENT);
    const total = currentTradeMode === 'buy' ? rawTotal + fee : rawTotal - fee;
    
    document.getElementById('trade-total-price').textContent = total.toLocaleString();
    document.getElementById('trade-fee').textContent = fee.toLocaleString();
};

// --- ส่วนที่ 1: ประกาศตัวแปรนับจำนวน (วางไว้บนสุดของไฟล์ หรือนอกฟังก์ชัน) ---
let tradeCounter = {}; 

// --- ส่วนที่ 2: ฟังก์ชันอัปเดตราคาแบบประหยัดโควต้า ---
async function updateStockPriceDynamic(stockId, qty, actionType) {
    // เริ่มนับจำนวนเทรดของหุ้นตัวนี้
    if (!tradeCounter[stockId]) tradeCounter[stockId] = 0;
    tradeCounter[stockId]++;

    // 🔥 LOGIC สำคัญ: ถ้ายังสะสมไม่ครบ 5 ครั้ง ให้จบฟังก์ชันเลย (ไม่ยิง Database)
    // คุณสามารถแก้เลข 5 เป็น 10 ได้ถ้าอยากประหยัดสุดๆ
    if (tradeCounter[stockId] < 3) {
        console.log(`⏳ สะสมยอดเทรดหุ้น ${stockId}: ${tradeCounter[stockId]}/3 (ยังไม่อัปเดตราคา)`);
        return; 
    }

    // เมื่อครบ 5 ครั้ง -> รีเซ็ตตัวนับ แล้วค่อยทำงานจริง
    tradeCounter[stockId] = 0;

    const stockRef = doc(db, 'artifacts', appId, 'public', 'data', 'stocks', stockId);
    
    try {
        await runTransaction(db, async (transaction) => {
            const stockDoc = await transaction.get(stockRef);
            if (!stockDoc.exists()) return;

            const data = stockDoc.data();
            const currentPrice = parseFloat(data.price);
            let newPrice = currentPrice;

            // คำนวณราคา (คูณ 3 เพราะเราอั้นมา 3 รอบ ถึงปล่อยทีนึง)
            // หรือจะคำนวณแบบปกติก็ได้ แต่ราคาจะขยับทีละนิด
            const batchMultiplier = 3; 
            const changePercent = (qty * MARKET_SENSITIVITY) * batchMultiplier; // คูณแรงขึ้นชดเชยรอบที่หายไป

            if (actionType === 'buy') {
                newPrice = currentPrice * (1 + changePercent);
            } else {
                newPrice = currentPrice * (1 - changePercent);
            }

            if (newPrice < MIN_STOCK_PRICE) newPrice = MIN_STOCK_PRICE;
            newPrice = Math.round(newPrice * 100) / 100;

            let history = data.price_history || [];
            if (history.length >= 50) history.shift(); 
            history.push({ price: newPrice, timestamp: Date.now() });

            transaction.update(stockRef, { 
                price: newPrice,
                prev_price: currentPrice,
                price_history: history,
                last_update: serverTimestamp()
            });
        });
        console.log(`✅ อัปเดตราคาหุ้น ${stockId} เรียบร้อย (Lot ใหญ่)!`);
    } catch (e) {
        console.error("Stock Price Update Failed:", e);
    }
}

// Modified executeTrade with Dynamic Pricing
window.executeTrade = async () => {
    if (config.market_status === 'closed') {
        return alert('⛔ ขณะนี้ตลาดหุ้น "ปิดทำการ" ครับ\n\n(ครูผู้สอนได้ปิดระบบการซื้อขายชั่วคราว)');
    }
    if (!currentTradeStock || !currentStudentData) return;

    const qty = parseInt(document.getElementById('trade-qty').value);
    const price = currentTradeStock.price;
    const rawTotal = qty * price;
    
    // คิดค่าธรรมเนียม (MARKET_FEE_PERCENT ต้องมีประกาศไว้ในโค้ดเดิม หรือใส่เลข 0.03 ตรงๆ)
    const feeRate = (typeof MARKET_FEE_PERCENT !== 'undefined') ? MARKET_FEE_PERCENT : 0.03;
    const fee = Math.ceil(rawTotal * feeRate);
    
    const totalAmount = currentTradeMode === 'buy' ? rawTotal + fee : rawTotal - fee;
    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', currentStudentData.id);
    const myPortfolio = currentStudentData.portfolio || [];
    const stockIndex = myPortfolio.findIndex(p => p.symbol === currentTradeStock.symbol);

    try {
        const batch = writeBatch(db);

        if (currentTradeMode === 'buy') {
            if (currentStudentData.points < totalAmount) return alert('แต้มไม่พอครับ!');
            
            // หักเงิน
            batch.update(sRef, { points: increment(-totalAmount) });
            
            // เพิ่มหุ้นเข้าพอร์ต
            let newPortfolio = [...myPortfolio];
            if (stockIndex > -1) {
                newPortfolio[stockIndex].amount += qty;
            } else {
                newPortfolio.push({ symbol: currentTradeStock.symbol, amount: qty });
            }
            batch.update(sRef, { portfolio: newPortfolio });
            
            showToast(`ซื้อ ${currentTradeStock.symbol} สำเร็จ! (-${totalAmount})`);

        } else { 
            // SELL
            if (stockIndex === -1 || myPortfolio[stockIndex].amount < qty) return alert('หุ้นไม่พอขายครับ!');
            
            // เพิ่มเงิน
            batch.update(sRef, { points: increment(totalAmount) });
            
            // ลดหุ้นออกจากพอร์ต
            let newPortfolio = [...myPortfolio];
            newPortfolio[stockIndex].amount -= qty;
            if (newPortfolio[stockIndex].amount <= 0) {
                newPortfolio.splice(stockIndex, 1); 
            }
            batch.update(sRef, { portfolio: newPortfolio });
            
            showToast(`ขาย ${currentTradeStock.symbol} สำเร็จ! (+${totalAmount})`);
        }

        // บันทึก History
        const hRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'history'));
        batch.set(hRef, {
            student_id: currentStudentData.student_id,
            student_name: currentStudentData.full_name,
            action: `${currentTradeMode === 'buy' ? 'ซื้อ' : 'ขาย'}หุ้น ${currentTradeStock.symbol} x${qty}`,
            amount: totalAmount,
            type: 'stock_trade',
            timestamp: serverTimestamp()
        });

        await batch.commit();
        closeTradeModal();

        // 🔥 [สำคัญ] สั่งให้ราคาขยับทันทีหลังเทรดสำเร็จ!
        // ส่ง: (รหัสหุ้น, จำนวนที่เทรด, 'buy' หรือ 'sell')
        updateStockPriceDynamic(currentTradeStock.id, qty, currentTradeMode);

    } catch(e) {
        console.error(e);
        alert(e.message);
    }
};

window.renderTeacherStockControl = () => {
    const tbody = document.getElementById('teacher-stock-list');
    const summaryDiv = document.getElementById('teacher-stock-summary'); // จุดที่จะวางปุ่มปิด/เปิดตลาด
    
    if (!tbody) return;

    // ==========================================
    // 1. คำนวณภาพรวมตลาด (Market Overview)
    // ==========================================
    let totalMarketCap = 0;
    let richList = [];

    students.forEach(s => {
        if (s.portfolio && s.portfolio.length > 0) {
            let portVal = 0;
            s.portfolio.forEach(p => {
                const stock = stocks.find(st => st.symbol === p.symbol);
                if (stock) portVal += p.amount * stock.price;
            });
            if (portVal > 0) {
                richList.push({ name: s.full_name, val: portVal });
                totalMarketCap += portVal;
            }
        }
    });

    richList.sort((a, b) => b.val - a.val);
    const topInvestors = richList.slice(0, 3);

    // ==========================================
    // 2. สร้าง HTML ส่วนสรุป + ปุ่มปิด/เปิดตลาด
    // ==========================================
    
    // 2.1 การ์ดสรุปยอด (Summary Cards)
    const summaryCardsHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div class="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <div class="text-xs font-bold text-indigo-400 uppercase">มูลค่าตลาดรวม</div>
                <div class="text-2xl font-bold text-indigo-700">${Math.floor(totalMarketCap).toLocaleString()} แต้ม</div>
                <div class="text-xs text-indigo-500 mt-1">นักลงทุน: ${richList.length} คน</div>
            </div>
            <div class="bg-emerald-50 p-4 rounded-xl border border-emerald-100 col-span-2">
                <div class="text-xs font-bold text-emerald-600 uppercase mb-2">🏆 เศรษฐีหุ้น (Top 3)</div>
                <div class="flex gap-4 overflow-x-auto">
                    ${topInvestors.length > 0 ? topInvestors.map((inv, i) => `
                        <div class="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-emerald-100 shadow-sm">
                            <span class="text-xs font-bold bg-emerald-100 text-emerald-600 w-5 h-5 flex items-center justify-center rounded-full">${i+1}</span>
                            <div>
                                <div class="text-sm font-bold text-gray-700">${inv.name}</div>
                                <div class="text-[10px] text-gray-500">${Math.floor(inv.val).toLocaleString()}</div>
                            </div>
                        </div>
                    `).join('') : '<div class="text-sm text-gray-400 italic">ยังไม่มีข้อมูล...</div>'}
                </div>
            </div>
        </div>
    `;

    // 2.2 แถบปุ่มปิด/เปิดตลาด (Market Status Toggle)
    const isMarketOpen = !config.market_status || config.market_status === 'open';
    const statusText = isMarketOpen ? '🟢 ตลาดเปิดทำการ' : '🔴 ตลาดปิดปรับปรุง';
    const btnColor = isMarketOpen ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600';
    const btnText = isMarketOpen ? 'สั่งปิดตลาด' : 'สั่งเปิดตลาด';

    const toggleHeaderHTML = `
        <div class="flex justify-between items-center mb-6 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div>
                <h3 class="font-bold text-gray-800 text-lg flex items-center gap-2">📈 ควบคุมตลาดหุ้น</h3>
                <div class="text-xs ${isMarketOpen ? 'text-green-600' : 'text-red-600'} font-bold mt-1">${statusText}</div>
            </div>
            <button onclick="toggleMarketStatus()" class="${btnColor} text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md transition-all active:scale-95">
                ${btnText}
            </button>
        </div>
    `;

    // 2.3 รวมร่างและแสดงผล
    if (summaryDiv) {
        summaryDiv.innerHTML = summaryCardsHTML + toggleHeaderHTML;
    }

    // ==========================================
    // 3. วาดกราฟและตาราง (เหมือนเดิม)
    // ==========================================
    renderMarketChart();    
    renderMarketActivity(); 

    tbody.innerHTML = stocks.map(stock => `
        <tr class="border-b hover:bg-gray-50">
            <td class="px-4 py-3 font-bold text-gray-800 align-top">
                <div class="flex items-center gap-2">
                    <span class="text-xl">${stock.icon || ''}</span>
                    <div class="flex flex-col">
                        <span>${stock.symbol}</span>
                        <button onclick="openEditStockModal('${stock.id}')" class="text-slate-400 hover:text-indigo-600 transition-colors" title="แก้ไขข้อมูลหุ้น">
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                        </button>
                        <span class="text-[10px] text-gray-400 font-normal">${stock.name}</span>
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 text-lg font-bold text-indigo-600 align-top">${Math.floor(stock.price)}</td>
            <td class="px-4 py-3 align-top">
                <div class="flex flex-col gap-2">
                    <div class="flex gap-1 flex-wrap">
                        <button onclick="updateStockPrice('${stock.id}', -5)" class="px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200 font-bold text-xs">-5</button>
                        <button onclick="updateStockPrice('${stock.id}', -3)" class="px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200 font-bold text-xs">-3</button>
                        <button onclick="updateStockPrice('${stock.id}', -1)" class="px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100 font-bold text-xs">-1</button>
                        <button onclick="updateStockPrice('${stock.id}', 1)" class="px-2 py-1 bg-green-50 text-green-500 rounded hover:bg-green-100 font-bold text-xs">+1</button>
                        <button onclick="updateStockPrice('${stock.id}', 3)" class="px-2 py-1 bg-green-100 text-green-600 rounded hover:bg-green-200 font-bold text-xs">+3</button>
                        <button onclick="updateStockPrice('${stock.id}', 5)" class="px-2 py-1 bg-green-100 text-green-600 rounded hover:bg-green-200 font-bold text-xs">+5</button>
                    </div>
                    <div class="flex gap-1">
                        <input type="number" id="manual-adj-${stock.id}" placeholder="+/-" class="w-full px-2 py-1 text-xs border border-gray-300 rounded outline-none" onkeypress="if(event.key === 'Enter') applyManualPrice('${stock.id}')">
                        <button onclick="applyManualPrice('${stock.id}')" class="px-3 py-1 bg-slate-800 text-white rounded hover:bg-slate-700 font-bold text-xs">OK</button>
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 text-right align-top">
                <div class="flex justify-end gap-2">
                    <button onclick="distributeDividend('${stock.id}', '${stock.symbol}')" class="px-3 py-1 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 font-bold text-xs flex items-center gap-1">💰 ปันผล</button>
                    <button onclick="deleteStock('${stock.id}')" class="text-gray-400 hover:text-red-500 text-xl">&times;</button>
                </div>
            </td>
        </tr>
    `).join('');
};

// 1. เปิด Modal สวยๆ แทน Prompt เดิม
window.addNewStockPrompt = () => {
    // รีเซ็ตค่าในฟอร์มให้ว่างเปล่า
    const symbolInput = document.getElementById('stock-symbol');
    const nameInput = document.getElementById('stock-name');
    const priceInput = document.getElementById('stock-price');
    const iconInput = document.getElementById('stock-icon');

    if(symbolInput) symbolInput.value = '';
    if(nameInput) nameInput.value = '';
    if(priceInput) priceInput.value = '100';
    if(iconInput) iconInput.value = '🏢'; // ค่า Default
    
    // แสดง Modal
    const modal = document.getElementById('add-stock-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        
        // Auto Focus ช่องชื่อย่อหุ้น
        setTimeout(() => symbolInput.focus(), 100);
    }
};

// 2. ฟังก์ชันบันทึกข้อมูล (ผูกกับปุ่ม Submit ใน Modal)
window.confirmAddStock = async (e) => {
    e.preventDefault(); // กันหน้าเว็บรีเฟรช
    
    const symbol = document.getElementById('stock-symbol').value.toUpperCase().trim();
    const name = document.getElementById('stock-name').value.trim();
    const price = parseInt(document.getElementById('stock-price').value);
    const icon = document.getElementById('stock-icon').value.trim() || '🏢';
    const desc = document.getElementById('stock-desc').value.trim(); // รับค่ารายละเอียด

    if (!symbol || !name || isNaN(price) || price <= 0) {
        return alert('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง');
    }

    try {
        const ref = doc(collection(db, 'artifacts', appId, 'public', 'data', 'stocks'));
        await setDoc(ref, {
            symbol: symbol,
            name: name,
            description: desc,
            price: price,
            prev_price: price, // ราคาตั้งต้น = ราคาปัจจุบัน
            icon: icon,
            created_at: serverTimestamp()
        });
        
        // ปิด Modal
        const modal = document.getElementById('add-stock-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.getElementById('stock-desc').value = '';
        
        showToast(`✅ นำหุ้น ${symbol} เข้าตลาดเรียบร้อย!`);
    } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
};

window.updateStockPrice = async (stockId, delta) => {
    const stock = stocks.find(s => s.id === stockId);
    if (!stock) return;

    const newPrice = Math.max(1, stock.price + delta); 
    
    // ✅ เก็บประวัติราคา (เอาไว้สร้างกราฟ)
    // ดึงประวัติเดิมมา (ถ้ามี) แล้วเพิ่มค่าใหม่เข้าไป
    let history = stock.price_history || [];
    // เก็บแค่ 20 จุดล่าสุดพอ (กันข้อมูลบวม)
    if (history.length >= 20) history.shift(); 
    history.push({ price: newPrice, timestamp: Date.now() });

    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'stocks', stockId);
    
    await updateDoc(ref, {
        price: newPrice,
        prev_price: stock.price,
        price_history: history, // บันทึก Array ประวัติลง DB
        last_update: serverTimestamp()
    });
};

window.deleteStock = async (stockId) => {
    // 1. ดึงข้อมูลหุ้นมาก่อน (เพื่อเอาราคาล่าสุดมาคืนเงินเด็ก)
    const stockRef = doc(db, 'artifacts', appId, 'public', 'data', 'stocks', stockId);
    const stockSnap = await getDoc(stockRef);
    
    if (!stockSnap.exists()) return alert("หาหุ้นไม่เจอแล้วครับ");
    const stockData = stockSnap.data();
    const refundPrice = stockData.price || 0;

    if(!confirm(`⚠️ ยืนยันการ "ถอดถอนหุ้น ${stockData.symbol}" ออกจากตลาด?\n\nระบบจะทำการ:\n1. บังคับขายหุ้นคืนให้นักเรียนทุกคน (ในราคา ${refundPrice} แต้ม)\n2. ลบหุ้นออกจากกระดานถาวร`)) return;

    try {
        // ใช้ Loading (ถ้ามี)
        // showLoading(true);

        // 2. ดึงนักเรียนทุกคนมาเช็ค
        const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'students'));
        const snapshot = await getDocs(q);
        const batch = writeBatch(db);
        
        let countAffected = 0;
        let totalRefund = 0;

        snapshot.docs.forEach(docSnap => {
            const s = docSnap.data();
            if (!s.portfolio || !Array.isArray(s.portfolio)) return;

            // เช็คว่ามีหุ้นตัวนี้ไหม
            const holdingIndex = s.portfolio.findIndex(p => p.symbol === stockData.symbol);
            
            if (holdingIndex !== -1) {
                const holding = s.portfolio[holdingIndex];
                if (holding.amount > 0) {
                    const refundAmount = holding.amount * refundPrice;
                    
                    // ลบหุ้นออกจากพอร์ต
                    const newPortfolio = [...s.portfolio];
                    newPortfolio.splice(holdingIndex, 1);

                    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', docSnap.id);
                    batch.update(sRef, { 
                        portfolio: newPortfolio,
                        points: increment(refundAmount) // คืนเงิน
                    });

                    // บันทึกประวัติ
                    const hRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'history'));
                    batch.set(hRef, {
                        student_id: s.student_id,
                        student_name: s.full_name,
                        action: `หุ้น ${stockData.symbol} ถูกถอดถอน (คืนเงิน ${holding.amount} หุ้น)`,
                        amount: refundAmount,
                        type: 'stock_delist',
                        timestamp: serverTimestamp()
                    });

                    countAffected++;
                    totalRefund += refundAmount;
                }
            }
        });

        // 3. ลบหุ้นออกจาก Master Data
        batch.delete(stockRef);

        await batch.commit();
        alert(`✅ ลบหุ้น ${stockData.symbol} เรียบร้อย!\n\n- คืนเงินให้นักเรียน: ${countAffected} คน\n- รวมยอดคืนเงิน: ${totalRefund} แต้ม`);

    } catch (e) {
        console.error(e);
        alert("เกิดข้อผิดพลาด: " + e.message);
    }
};

// ==========================================
// 💸 ระบบจ่ายปันผล (Dividend System)
// ==========================================
window.distributeDividend = async (stockId, symbol) => {
    // 1. ถามครูว่าจะจ่ายหุ้นละกี่แต้ม
    const rateStr = prompt(`💰 จ่ายปันผลหุ้น ${symbol}\n\nระบุจำนวนแต้มต่อ 1 หุ้น (Dividend per Share):`, "5");
    if (!rateStr) return;
    
    const rate = parseInt(rateStr);
    if (isNaN(rate) || rate <= 0) return alert("กรุณาระบุจำนวนแต้มให้ถูกต้อง");

    if (!confirm(`ยืนยันการจ่ายปันผลหุ้น ${symbol}\nในอัตรา ${rate} แต้ม/หุ้น ?\n\n(ระบบจะโอนแต้มให้นักเรียนทุกคนที่ถือหุ้นนี้ทันที)`)) return;

    try {
        showLoading(true); // (ถ้ามีฟังก์ชัน Loading) หรืออาจจะใช้ alert รอ
        
        // 2. ดึงข้อมูลนักเรียนทุกคนที่มีพอร์ตหุ้น
        // (เนื่องจาก Firestore NoSQL ค้นหาใน Array ลึกๆ ยาก เราจึงดึงนร.ทุกคนมาเช็คใน Loop แทน ซึ่งปลอดภัยและง่ายกว่าสำหรับสเกลห้องเรียน)
        const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'students'));
        const snapshot = await getDocs(q);
        
        const batch = writeBatch(db);
        let countStudent = 0;
        let totalPayout = 0;

        snapshot.docs.forEach(docSnap => {
            const s = docSnap.data();
            if (!s.portfolio || !Array.isArray(s.portfolio)) return;

            // หาว่านักเรียนคนนี้ถือหุ้นตัวนี้ไหม
            const holding = s.portfolio.find(p => p.symbol === symbol && p.amount > 0);
            
            if (holding) {
                const payout = holding.amount * rate; // เงินปันผลที่ได้รับ
                
                // สั่งโอนแต้ม
                const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', docSnap.id);
                batch.update(sRef, { points: increment(payout) });
                
                // บันทึกประวัติ
                const hRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'history')); // สร้าง ID ใหม่
                batch.set(hRef, {
                    student_id: s.student_id,
                    student_name: s.full_name,
                    action: `รับปันผลหุ้น ${symbol} (${holding.amount} หุ้น x ${rate})`,
                    amount: payout,
                    type: 'dividend',
                    timestamp: serverTimestamp()
                });

                countStudent++;
                totalPayout += payout;
            }
        });

        if (countStudent === 0) {
            alert("ไม่มีนักเรียนคนไหนถือหุ้นตัวนี้เลยครับ");
            return;
        }

        // 3. ยืนยันการทำรายการ
        await batch.commit();
        alert(`✅ จ่ายปันผลเรียบร้อย!\n\n- นักเรียนที่ได้รับ: ${countStudent} คน\n- รวมยอดจ่ายทั้งสิ้น: ${totalPayout} แต้ม`);

    } catch (error) {
        console.error("Dividend Error:", error);
        alert("เกิดข้อผิดพลาด: " + error.message);
    } finally {
        showLoading(false);
    }
};

// ฟังก์ชันเสริม (เผื่อในโค้ดไม่มี showLoading)
function showLoading(show) {
    // ถ้ามี Loading Modal ให้เรียกใช้ ถ้าไม่มีก็ปล่อยผ่าน
    const l = document.getElementById('loading-modal'); // สมมติว่ามี
    if(l) { 
        if(show) l.classList.remove('hidden'); 
        else l.classList.add('hidden'); 
    }
}

// ==========================================
// 📊 ส่วนเสริม: กราฟและ Activity Log
// ==========================================

let marketChartInstance = null; // ตัวแปรเก็บกราฟ (กันกราฟซ้อนกัน)

window.renderMarketChart = () => {
    const ctx = document.getElementById('marketChart');
    if (!ctx) return;

    // เตรียมข้อมูลกราฟ
    const datasets = stocks.map((stock, index) => {
        // ถ้าเพิ่งสร้างหุ้นใหม่ ยังไม่มีประวัติ ให้ใช้ราคาปัจจุบันเป็นจุดเริ่ม
        const history = stock.price_history || [{ price: stock.price, timestamp: Date.now() }];
        
        // สีเส้นกราฟ (สุ่มสีตาม Index หรือใช้สีประจำหุ้น)
        const colors = ['#4f46e5', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
        const color = colors[index % colors.length];

        return {
            label: stock.symbol,
            data: history.map(h => h.price),
            borderColor: color,
            backgroundColor: color + '20', // สีจางๆ
            tension: 0.3, // ความโค้งของเส้น
            pointRadius: 3
        };
    });

    // สร้าง Label แกน X (ใช้จำนวนครั้งที่ปรับราคา 1, 2, 3...)
    // (เพราะแต่ละหุ้นปรับไม่พร้อมกัน การใช้ Time Axis จะดูยากสำหรับเคสนี้)
    const maxDataPoints = Math.max(...datasets.map(d => d.data.length), 5);
    const labels = Array.from({length: maxDataPoints}, (_, i) => i + 1);

    // ถ้ามีกราฟเก่าอยู่ ให้ทำลายทิ้งก่อน (ไม่งั้นกราฟจะกระพริบซ้อนกัน)
    if (marketChartInstance) marketChartInstance.destroy();

    marketChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f3f4f6' } },
                x: { display: false } // ซ่อนแกน X เพื่อความสะอาดตา
            },
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
};

window.renderMarketActivity = () => {
    const logContainer = document.getElementById('market-activity-log');
    if (!logContainer) return;

    // ✅ ใช้ข้อมูลจากประวัติที่มีอยู่แล้ว (history) ไม่ต้องโหลดใหม่ ไม่ค้างแน่นอน
    // กรองเอาเฉพาะการซื้อขายหุ้น (stock_trade) 20 รายการล่าสุด
    const trades = history.filter(h => h.type === 'stock_trade').slice(0, 20);

    if (trades.length === 0) {
        logContainer.innerHTML = `<div class="text-center text-gray-400 text-xs py-4">ยังไม่มีการซื้อขายวันนี้</div>`;
        return;
    }

    logContainer.innerHTML = trades.map(h => {
        const isBuy = h.action.includes('ซื้อ');
        const icon = isBuy ? '🟢' : '🔴';
        const colorClass = isBuy ? 'text-green-600' : 'text-red-600';
        
        let timeStr = '';
        if (h.timestamp) {
            const dateObj = h.timestamp.toDate ? h.timestamp.toDate() : new Date(h.timestamp);
            timeStr = dateObj.toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'});
        }

        return `
            <div class="flex items-start gap-3 p-2 hover:bg-gray-50 rounded-lg transition-colors border-b border-gray-50 last:border-0">
                <div class="text-lg mt-0.5">${icon}</div>
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-bold text-gray-800 truncate">${h.student_name}</div>
                    <div class="text-xs ${colorClass} font-medium truncate">${h.action}</div>
                </div>
                <div class="text-[10px] text-gray-400 whitespace-nowrap">${timeStr}</div>
            </div>
        `;
    }).join('');
};

window.applyManualPrice = (stockId) => {
    const input = document.getElementById('manual-adj-' + stockId);
    if (!input || !input.value) return;
    
    const val = parseInt(input.value);
    if (isNaN(val) || val === 0) return;
    
    // เรียกใช้ฟังก์ชันเดิมที่มีอยู่แล้ว
    updateStockPrice(stockId, val);
    
    // เคลียร์ค่าทิ้ง เตรียมรับค่าใหม่
    input.value = ''; 
};

// ==========================================
// 💰 ระบบจ่ายปันผลหมู่ (Batch Dividend)
// ==========================================

// 1. เปิด Modal และสร้างรายการหุ้น
window.openBatchDividendModal = () => {
    const modal = document.getElementById('batch-dividend-modal');
    const listContainer = document.getElementById('batch-dividend-list');
    
    if (!modal || !listContainer) return;
    
    // สร้างรายการหุ้นแบบ Checkbox
    listContainer.innerHTML = stocks.map(stock => `
        <div class="grid grid-cols-12 gap-4 items-center p-3 bg-white border border-slate-200 rounded-xl hover:border-amber-300 transition-colors shadow-sm group">
            <div class="col-span-1 flex justify-center">
                <input type="checkbox" 
                       id="batch-div-check-${stock.id}" 
                       onchange="toggleBatchDividendInput('${stock.id}')"
                       class="w-5 h-5 accent-amber-500 cursor-pointer">
            </div>
            
            <div class="col-span-6 flex items-center gap-3 opacity-50 group-hover:opacity-100 transition-opacity" id="batch-div-info-${stock.id}">
                <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-xl border border-slate-100 shadow-sm">
                    ${stock.icon || '📈'}
                </div>
                <div>
                    <div class="font-bold text-slate-700 leading-tight">${stock.symbol}</div>
                    <div class="text-[10px] text-slate-400 truncate max-w-[120px]">${stock.name}</div>
                </div>
            </div>
            
            <div class="col-span-5">
                <div class="relative">
                    <input type="number" 
                           id="batch-div-rate-${stock.id}" 
                           disabled
                           placeholder="0" 
                           class="w-full pl-3 pr-8 py-2 border-2 border-slate-100 rounded-lg text-right font-bold text-slate-700 disabled:bg-slate-50 disabled:text-slate-300 focus:border-amber-500 focus:bg-amber-50 outline-none transition-all"
                    >
                    <div class="absolute right-3 top-2 text-xs font-bold text-slate-400 pointer-events-none">P</div>
                </div>
            </div>
        </div>
    `).join('');

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

// 2. ปิด Modal
window.closeBatchDividendModal = () => {
    const modal = document.getElementById('batch-dividend-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

// 3. เปิด/ปิด ช่องกรอกตาม Checkbox
window.toggleBatchDividendInput = (stockId) => {
    const checkbox = document.getElementById(`batch-div-check-${stockId}`);
    const input = document.getElementById(`batch-div-rate-${stockId}`);
    const info = document.getElementById(`batch-div-info-${stockId}`);
    
    if (checkbox && input) {
        input.disabled = !checkbox.checked;
        
        if (checkbox.checked) {
            info.classList.remove('opacity-50');
            input.value = '5'; // ค่า Default 5 แต้ม
            input.focus();
            input.select();
        } else {
            info.classList.add('opacity-50');
            input.value = '';
        }
    }
};

// 4. ยืนยันการแจกปันผล (หัวใจหลัก 💖)
window.confirmBatchDividend = async () => {
    // รวบรวมข้อมูลหุ้นที่เลือก
    const payouts = [];
    stocks.forEach(stock => {
        const checkbox = document.getElementById(`batch-div-check-${stock.id}`);
        const input = document.getElementById(`batch-div-rate-${stock.id}`);
        
        if (checkbox && checkbox.checked) {
            const rate = parseInt(input.value);
            if (!isNaN(rate) && rate > 0) {
                payouts.push({ id: stock.id, symbol: stock.symbol, rate: rate });
            }
        }
    });

    if (payouts.length === 0) return alert("กรุณาเลือกหุ้นและระบุจำนวนเงินปันผลอย่างน้อย 1 รายการครับ");

    // คำนวณยอดรวมเพื่อยืนยัน
    let grandTotal = 0;
    students.forEach(s => {
        if (!s.portfolio) return;
        payouts.forEach(p => {
            const holding = s.portfolio.find(h => h.symbol === p.symbol);
            if (holding && holding.amount > 0) {
                grandTotal += holding.amount * p.rate;
            }
        });
    });

    const msg = `💰 สรุปยอดการจ่ายปันผล:\n` +
                payouts.map(p => `- ${p.symbol}: ${p.rate} แต้ม/หุ้น`).join('\n') +
                `\n\n--------------------------------\n` +
                `รวมยอดจ่ายทั้งหมด: ${grandTotal.toLocaleString()} แต้ม\n` +
                `ยืนยันที่จะดำเนินการหรือไม่?`;

    if (!confirm(msg)) return;

    try {
        const batch = writeBatch(db);
        let txCount = 0;

        // วนลูปแจกเงินนักเรียนทีละคน
        students.forEach(s => {
            if (!s.portfolio) return;
            
            let receivedTotal = 0;
            let details = [];

            payouts.forEach(p => {
                const holding = s.portfolio.find(h => h.symbol === p.symbol);
                if (holding && holding.amount > 0) {
                    const amount = holding.amount * p.rate;
                    receivedTotal += amount;
                    details.push(`${p.symbol} (${amount})`);
                }
            });

            if (receivedTotal > 0) {
                // 1. เพิ่มเงินให้นักเรียน
                const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
                batch.update(sRef, { points: increment(receivedTotal) });

                // 2. บันทึกประวัติ (รวมยอดทีเดียว เพื่อประหยัด Database)
                const hRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'history'));
                batch.set(hRef, {
                    student_id: s.student_id,
                    student_name: s.full_name,
                    action: `รับปันผลหมู่: ${details.join(', ')}`,
                    amount: receivedTotal,
                    type: 'dividend_batch',
                    timestamp: serverTimestamp()
                });
                txCount++;
            }
        });

        await batch.commit();
        closeBatchDividendModal();
        alert(`✅ จ่ายปันผลเรียบร้อย!\nมีนักเรียนได้รับเงินทั้งหมด: ${txCount} คน`);
        
    } catch (err) {
        console.error(err);
        alert("เกิดข้อผิดพลาด: " + err.message);
    }
};

// ==========================================
// 🕵️ ระบบส่องพอร์ต (Portfolio Inspector)
// ==========================================
// ตัวแปรเก็บข้อมูลพอร์ตทั้งหมด (เพื่อใช้กรอง)
let allPortfolioData = [];

window.openPortfolioInspector = () => {
    const modal = document.getElementById('portfolio-inspector-modal');
    
    // 1. คำนวณข้อมูลเตรียมไว้ครั้งเดียว (Cache Data)
    const investors = students.filter(s => s.portfolio && s.portfolio.length > 0);
    
    allPortfolioData = investors.map(s => {
        let totalVal = 0;
        const details = s.portfolio.map(p => {
            const stock = stocks.find(st => st.symbol === p.symbol);
            if (!stock) return null;
            const val = p.amount * stock.price;
            totalVal += val;
            return {
                symbol: p.symbol,
                amount: p.amount,
                price: stock.price,
                icon: stock.icon || '📄'
            };
        }).filter(d => d !== null);

        return { ...s, totalVal, details };
    });

    // เรียงลำดับ (รวยสุดขึ้นก่อน)
    allPortfolioData.sort((a, b) => b.totalVal - a.totalVal);

    // 2. เคลียร์ช่องค้นหา
    const searchInput = document.getElementById('portfolio-search-input');
    if(searchInput) searchInput.value = '';

    // 3. สั่งวาดตาราง
    renderPortfolioList(allPortfolioData);

    // 4. เปิด Modal
    if(modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
};

// ฟังก์ชันวาดตาราง (แยกออกมาเพื่อให้เรียกซ้ำได้ตอนค้นหา)
window.renderPortfolioList = (dataList) => {
    const list = document.getElementById('portfolio-inspector-list');
    if (!list) return;

    if (dataList.length === 0) {
        list.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-slate-400">ไม่พบข้อมูล... 🦗</td></tr>`;
        return;
    }

    list.innerHTML = dataList.map(s => {
        const portName = s.portfolio_name || 'พอร์ตการลงทุนทั่วไป';
        const portDesc = s.portfolio_desc ? `<div class="text-[10px] text-slate-500 mt-1 italic line-clamp-1">"${s.portfolio_desc}"</div>` : '';

        return `
            <tr class="hover:bg-slate-50 transition-colors group">
                <td class="p-4 border-r border-slate-100 align-top">
                    <div class="flex justify-between items-start">
                        <div>
                            <div class="font-bold text-slate-800">${s.full_name}</div>
                            <div class="text-[10px] text-slate-400 mb-1">${s.student_id}</div>
                            <div class="inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded font-bold border border-indigo-100">
                                📝 ${portName}
                            </div>
                            ${portDesc}
                        </div>
                        <button onclick="openPortfolioEditor('${s.id}')" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-indigo-600 p-1 transition-all" title="แก้ไขชื่อพอร์ต">
                            ✏️
                        </button>
                    </div>
                </td>
                <td class="p-4 text-right font-mono font-bold text-indigo-600 border-r border-slate-100 align-top">
                    ${Math.floor(s.totalVal).toLocaleString()}
                </td>
                <td class="p-4 align-top">
                    <div class="flex flex-wrap gap-2">
                        ${s.details.map(d => `
                            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg shadow-sm text-xs">
                                <span class="text-base">${d.icon}</span>
                                <span class="font-bold text-slate-700">${d.symbol}</span>
                                <span class="bg-slate-100 px-1.5 rounded text-slate-500 font-mono">x${d.amount}</span>
                            </div>
                        `).join('')}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
};

// ฟังก์ชันกรองรายชื่อ (ทำงานตอนพิมพ์)
window.filterPortfolioList = () => {
    const query = document.getElementById('portfolio-search-input').value.toLowerCase().trim();
    
    if (!query) {
        renderPortfolioList(allPortfolioData); // ถ้าลบคำค้นหา ให้โชว์ทั้งหมด
        return;
    }

    const filtered = allPortfolioData.filter(s => 
        s.full_name.toLowerCase().includes(query) || 
        s.student_id.toString().includes(query)
    );

    renderPortfolioList(filtered);
};

// ==========================================
// 🔴 ระบบเปิด/ปิดตลาด (Market Status)
// ==========================================
window.toggleMarketStatus = async () => {
    // อ่านค่าปัจจุบัน (ถ้าไม่มีถือว่าเปิด)
    const currentStatus = config.market_status || 'open';
    const newStatus = currentStatus === 'open' ? 'closed' : 'open';
    const msg = newStatus === 'open' ? '🟢 เปิดตลาดหุ้น' : '🔴 ปิดตลาดหุ้น';

    if(!confirm(`ยืนยันการ "${msg}" ?\n\n(เมื่อปิดตลาด นักเรียนจะไม่สามารถส่งคำสั่งซื้อขายได้)`)) return;

    try {
        // บันทึกลง Config รวมของโรงเรียน
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'school_settings'), {
            market_status: newStatus
        }, { merge: true });
        
        showToast(`✅ ${msg} เรียบร้อยแล้ว`);
    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

// ==========================================
// 📝 ระบบแก้ไขรายละเอียดพอร์ต (Name & Description)
// ==========================================
let editingStudentId = null;

window.openPortfolioEditor = (docId) => {
    const s = students.find(st => st.id === docId);
    if (!s) return;

    editingStudentId = docId;
    
    // แสดงชื่อนักเรียน
    document.getElementById('edit-port-student-name').textContent = s.full_name;
    
    // ดึงข้อมูลเดิมมาใส่ (ถ้ามี)
    document.getElementById('edit-port-name').value = s.portfolio_name || '';
    document.getElementById('edit-port-desc').value = s.portfolio_desc || '';
    
    // เปิด Modal
    const modal = document.getElementById('edit-portfolio-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closePortfolioEditor = () => {
    const modal = document.getElementById('edit-portfolio-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    editingStudentId = null;
};

window.savePortfolioDetails = async () => {
    if (!editingStudentId) return;
    
    const name = document.getElementById('edit-port-name').value.trim();
    const desc = document.getElementById('edit-port-desc').value.trim();
    
    try {
        const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', editingStudentId);
        
        // อัปเดตแค่ชื่อและรายละเอียด (ไม่ยุ่งกับหุ้นในพอร์ต)
        await updateDoc(sRef, { 
            portfolio_name: name,
            portfolio_desc: desc
        });
        
        showToast(`บันทึกข้อมูลพอร์ตเรียบร้อย`);
        closePortfolioEditor();
        
        // ถ้าเปิดหน้าส่องพอร์ตอยู่ ให้รีเฟรชข้อมูลด้วย
        if(document.getElementById('portfolio-inspector-modal').classList.contains('flex')) {
            openPortfolioInspector();
        }

    } catch (e) {
        console.error(e);
        alert('บันทึกไม่สำเร็จ: ' + e.message);
    }
};

// ==========================================
// ✏️ ระบบแก้ไขหุ้น (Edit Stock Info)
// ==========================================
window.openEditStockModal = (stockId) => {
    const stock = stocks.find(s => s.id === stockId);
    if (!stock) return;

    document.getElementById('edit-stock-id').value = stock.id;
    document.getElementById('edit-stock-symbol').value = stock.symbol;
    document.getElementById('edit-stock-name').value = stock.name;
    document.getElementById('edit-stock-icon').value = stock.icon || '🏢';
    document.getElementById('edit-stock-desc').value = stock.description || '';

    const modal = document.getElementById('edit-stock-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeEditStockModal = () => {
    const modal = document.getElementById('edit-stock-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.confirmEditStock = async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('edit-stock-id').value;
    const name = document.getElementById('edit-stock-name').value.trim();
    const icon = document.getElementById('edit-stock-icon').value.trim();
    const desc = document.getElementById('edit-stock-desc').value.trim();

    if (!name) return alert('กรุณาระบุชื่อบริษัท');

    try {
        const ref = doc(db, 'artifacts', appId, 'public', 'data', 'stocks', id);
        await updateDoc(ref, {
            name: name,
            icon: icon,
            description: desc
        });
        
        showToast(`แก้ไขข้อมูลหุ้น ${document.getElementById('edit-stock-symbol').value} เรียบร้อย`);
        closeEditStockModal();
        
        // รีเฟรชหน้าครู (ถ้าเปิดอยู่)
        if(window.renderTeacherStockControl) renderTeacherStockControl();

    } catch (err) {
        console.error(err);
        alert('แก้ไขไม่สำเร็จ: ' + err.message);
    }
};

// ==========================================
// 🛒 ระบบ Broker Mode (ครูเทรดแทนนักเรียน)
// ==========================================

window.openBrokerModal = () => {
    const modal = document.getElementById('broker-modal');
    
    // 1. เติมรายชื่อหุ้นลง Dropdown
    const stockSelect = document.getElementById('broker-stock-select');
    stockSelect.innerHTML = stocks.map(s => 
        `<option value="${s.id}" data-price="${s.price}">${s.symbol} (${Math.floor(s.price)})</option>`
    ).join('');

    // 2. เติมรายชื่อนักเรียน (โหลดครั้งแรก)
    renderBrokerStudentList();
    
    // 3. รีเซ็ตค่าต่างๆ
    document.getElementById('broker-action').value = 'buy';
    document.getElementById('broker-qty').value = '1';
    updateBrokerPrice(); // อัปเดตราคาเริ่มต้น

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeBrokerModal = () => {
    document.getElementById('broker-modal').classList.add('hidden');
    document.getElementById('broker-modal').classList.remove('flex');
};

// ฟังก์ชันค้นหาและสร้างรายชื่อนักเรียนใน Dropdown
window.renderBrokerStudentList = () => {
    const search = document.getElementById('broker-student-search').value.toLowerCase();
    const select = document.getElementById('broker-student-select');
    
    // กรองและเรียงลำดับ
    const filtered = students.filter(s => 
        s.full_name.toLowerCase().includes(search) || 
        s.student_id.toString().includes(search)
    ).sort((a, b) => a.student_id - b.student_id);

    select.innerHTML = '<option value="">-- เลือกนักเรียน --</option>' + 
        filtered.map(s => `<option value="${s.id}">${s.student_id} - ${s.full_name}</option>`).join('');
};

// แสดงยอดเงินคงเหลือของนักเรียนที่เลือก
window.updateBrokerPortfolioInfo = () => {
    const studentId = document.getElementById('broker-student-select').value;
    const infoBox = document.getElementById('broker-balance-info');
    const cashSpan = document.getElementById('broker-student-cash');

    if (!studentId) {
        infoBox.classList.add('hidden');
        return;
    }

    const s = students.find(st => st.id === studentId);
    if (s) {
        cashSpan.textContent = Math.floor(s.points).toLocaleString();
        infoBox.classList.remove('hidden');
        calculateBrokerLimits();
    }
};

// อัปเดตราคาตลาดเมื่อเปลี่ยนหุ้น
window.updateBrokerPrice = () => {
    const select = document.getElementById('broker-stock-select');
    const priceDisplay = document.getElementById('broker-current-price');
    
    // ดึงราคาจาก attribute data-price ที่ฝังไว้ หรือค้นหาใหม่
    const option = select.options[select.selectedIndex];
    if (option) {
        // หา object หุ้นจริงๆ เพื่อความชัวร์
        const stock = stocks.find(s => s.id === select.value);
        if(stock) {
            priceDisplay.textContent = Math.floor(stock.price).toLocaleString();
            calculateBrokerLimits();
            updateBrokerTotal();
        }
    }
};

// คำนวณราคารวม
window.updateBrokerTotal = () => {
    const select = document.getElementById('broker-stock-select');
    const action = document.getElementById('broker-action').value; // buy/sell
    const qty = parseInt(document.getElementById('broker-qty').value) || 0;
    const stockId = select.value;
    
    // หาข้อมูลหุ้น
    const stock = stocks.find(s => s.id === stockId);
    
    if (stock && qty > 0) {
        const rawAmount = Math.floor(stock.price) * qty;
        const fee = Math.floor(rawAmount * 0.03); // ค่าธรรมเนียม 3%
        let netAmount = 0;
        let text = '';

        if (action === 'buy') {
            netAmount = rawAmount + fee; // ซื้อ: ราคาของ + ค่าธรรมเนียม
            text = `${Math.floor(netAmount).toLocaleString()} (รวม Fee: ${fee})`;
            
            // เปลี่ยนสีตัวเลข
            document.getElementById('broker-total').className = 'text-xl font-bold text-red-600'; 
        } else {
            netAmount = rawAmount - fee; // ขาย: ราคาของ - ค่าธรรมเนียม
            text = `${Math.floor(netAmount).toLocaleString()} (หัก Fee: ${fee})`;
            
            // เปลี่ยนสีตัวเลข
            document.getElementById('broker-total').className = 'text-xl font-bold text-green-600';
        }

        document.getElementById('broker-total').textContent = text;
    } else {
        document.getElementById('broker-total').textContent = '0';
    }
};

// ยืนยันการเทรด (หัวใจหลัก)
// Modified confirmBrokerTrade with Dynamic Pricing
window.confirmBrokerTrade = async () => {
    const studentDocId = document.getElementById('broker-student-select').value;
    const stockId = document.getElementById('broker-stock-select').value;
    const action = document.getElementById('broker-action').value; // buy / sell
    const qty = parseInt(document.getElementById('broker-qty').value);

    if (!studentDocId) return alert('กรุณาเลือกนักเรียนก่อนครับ');
    if (!stockId) return alert('กรุณาเลือกหุ้น');
    if (qty <= 0) return alert('จำนวนต้องมากกว่า 0');

    const stock = stocks.find(s => s.id === stockId);
    const student = students.find(s => s.id === studentDocId);

    // 1. คำนวณยอดเงินและค่าธรรมเนียม
    const rawAmount = Math.floor(stock.price) * qty;
    const fee = Math.floor(rawAmount * 0.03); // 3%
    let netAmount = 0;
    let logAction = '';

    if (action === 'buy') {
        netAmount = rawAmount + fee; // จ่ายเพิ่ม
    } else {
        netAmount = rawAmount - fee; // ได้น้อยลง
    }

    const confirmMsg = action === 'buy' 
        ? `ซื้อหุ้น ${stock.symbol} x${qty}\nราคาหุ้น: ${rawAmount}\nค่าธรรมเนียม: ${fee}\nรวมจ่ายสุทธิ: ${netAmount} แต้ม`
        : `ขายหุ้น ${stock.symbol} x${qty}\nมูลค่าหุ้น: ${rawAmount}\nหักค่าธรรมเนียม: ${fee}\nได้รับสุทธิ: ${netAmount} แต้ม`;

    if (!confirm(`ยืนยันทำรายการให้ ${student.full_name} ?\n\n${confirmMsg}`)) return;

    try {
        const batch = writeBatch(db);
        const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', studentDocId);
        
        let newPortfolio = [...(student.portfolio || [])];
        const stockIndex = newPortfolio.findIndex(p => p.symbol === stock.symbol);

        if (action === 'buy') {
            if (student.points < netAmount) {
                return alert(`เงินนักเรียนไม่พอครับ (มี ${student.points} / ต้องใช้ ${netAmount})`);
            }
            batch.update(sRef, { points: increment(-netAmount) });
            if (stockIndex > -1) {
                newPortfolio[stockIndex].amount += qty;
            } else {
                newPortfolio.push({ symbol: stock.symbol, amount: qty });
            }
            logAction = `[ครูเทรด] ซื้อ ${stock.symbol} x${qty} (รวมค่าธรรมเนียม ${fee})`;
        } else {
            if (stockIndex === -1 || newPortfolio[stockIndex].amount < qty) {
                return alert('นักเรียนมีหุ้นไม่พอขายครับ');
            }
            batch.update(sRef, { points: increment(netAmount) });
            newPortfolio[stockIndex].amount -= qty;
            if (newPortfolio[stockIndex].amount <= 0) {
                newPortfolio.splice(stockIndex, 1);
            }
            logAction = `[ครูเทรด] ขาย ${stock.symbol} x${qty} (หักค่าธรรมเนียม ${fee})`;
        }

        batch.update(sRef, { portfolio: newPortfolio });

        const hRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'history'));
        batch.set(hRef, {
            student_id: student.student_id,
            student_name: student.full_name,
            action: logAction,
            amount: netAmount,
            type: 'stock_trade_broker',
            timestamp: serverTimestamp()
        });

        await batch.commit();
        alert('✅ ทำรายการสำเร็จเรียบร้อย!');
        closeBrokerModal();

        // 🔥 [สำคัญ] สั่งอัปเดตราคาแบบ Real-time
        updateStockPriceDynamic(stockId, qty, action);

        if(window.renderBrokerStudentList) renderBrokerStudentList();

    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

// ==========================================
// 🧠 Broker Smart Context (คำนวณลิมิตอัตโนมัติ)
// ==========================================

window.calculateBrokerLimits = () => {
    const studentId = document.getElementById('broker-student-select').value;
    const stockId = document.getElementById('broker-stock-select').value;
    const action = document.getElementById('broker-action').value; // buy/sell
    
    // Elements
    const holdingDisplay = document.getElementById('broker-holding-display');
    const maxBtn = document.getElementById('broker-max-btn');
    const limitLabel = document.getElementById('broker-limit-label');

    if (!studentId || !stockId) {
        holdingDisplay.textContent = '-';
        maxBtn.textContent = '0';
        return;
    }

    const student = students.find(s => s.id === studentId);
    const stock = stocks.find(s => s.id === stockId);
    
    if (!student || !stock) return;

    // 1. หาจำนวนที่ถืออยู่ (Holdings)
    const port = student.portfolio || [];
    const holding = port.find(p => p.symbol === stock.symbol);
    const holdingAmount = holding ? holding.amount : 0;
    
    holdingDisplay.textContent = `${holdingAmount} หุ้น`;

    // 2. คำนวณลิมิต (Max)
    let maxQty = 0;
    
    if (action === 'buy') {
        // สูตร: เงินที่มี / (ราคาหุ้น + ค่าธรรมเนียม 3%)
        const costPerShare = stock.price * 1.03;
        if (costPerShare > 0) {
            maxQty = Math.floor(student.points / costPerShare);
        }
        limitLabel.textContent = 'ซื้อได้สูงสุด:';
        maxBtn.className = 'font-bold text-green-600 hover:text-green-800 underline ml-1 cursor-pointer';
    } else {
        // ขาย: ขายได้เท่าที่มี
        maxQty = holdingAmount;
        limitLabel.textContent = 'ขายได้สูงสุด:';
        maxBtn.className = 'font-bold text-red-600 hover:text-red-800 underline ml-1 cursor-pointer';
    }

    maxBtn.textContent = maxQty.toLocaleString();
    maxBtn.dataset.value = maxQty; // เก็บค่าดิบไว้ใช้ตอนกด
};

// ฟังก์ชันกดปุ่ม Max
window.setBrokerMaxQty = () => {
    const maxBtn = document.getElementById('broker-max-btn');
    const qtyInput = document.getElementById('broker-qty');
    
    const val = parseInt(maxBtn.dataset.value) || 0;
    if (val > 0) {
        qtyInput.value = val;
        updateBrokerTotal(); // สั่งคำนวณยอดเงินใหม่ทันที
    } else {
        alert('ไม่สามารถทำรายการได้ (ยอดเป็น 0)');
    }
};

// ==========================================
// 🎁 ระบบแจกคูปองบัฟ (Buff Coupon System)
// ==========================================

window.openGiveBuffModal = () => {
    // เช็คก่อนว่ามีการเลือกนักเรียนหรือยัง
    if (selectedStudentIds.size === 0) return alert('กรุณาเลือกนักเรียนก่อนครับ');
    // 2. ดึงข้อมูลนักเรียนที่เลือกมาเตรียมไว้
    const recipients = [];
    selectedStudentIds.forEach(id => {
        const s = students.find(std => std.id === id);
        if (s) recipients.push(s);
    });
    // 3. อัปเดตตัวเลขจำนวนคน
    const countEl = document.getElementById('buff-recipient-count');
    if(countEl) countEl.textContent = `${recipients.length} คน`;

    // 4. สร้าง HTML รายชื่อ (Badge สวยๆ)
    const listEl = document.getElementById('buff-recipient-list');
    if(listEl) {
        if (recipients.length > 0) {
            listEl.innerHTML = recipients.map(s => `
                <div class="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-50 border border-indigo-200 text-xs text-indigo-700">
                    <span class="font-bold">${s.student_id}</span>
                    <span>${s.full_name}</span>
                    <span class="text-[10px] text-gray-400 bg-white px-1 rounded border ml-1">${s.class_name || '-'}</span>
                </div>
            `).join('');
        } else {
            listEl.innerHTML = '<span class="text-xs text-red-400">ไม่พบข้อมูลนักเรียน</span>';
        }
    }
    document.getElementById('give-buff-modal').classList.remove('hidden');
};

window.confirmGiveBuff = async () => {
    const type = document.getElementById('buff-type-select').value;
    const value = parseFloat(document.getElementById('buff-value-input').value);
    const durationNum = parseInt(document.getElementById('buff-duration-input').value);
    const unit = document.getElementById('buff-unit-select').value;
    let customName = document.getElementById('buff-name-input').value.trim();

    if (!value || !durationNum) return alert('กรุณากรอกข้อมูลให้ครบถ้วน');

    // คำนวณเป็นนาที (Standard Unit)
    let durationMinutes = durationNum;
    if (unit === 'hour') durationMinutes = durationNum * 60;
    if (unit === 'day') durationMinutes = durationNum * 1440;

    // ตั้งชื่ออัตโนมัติถ้าไม่ได้กรอก
    if (!customName) {
        const typeNames = { interest: 'ดอกเบี้ย', discount: 'ส่วนลดร้านค้า', boost: 'บูสต์แต้ม' };
        customName = `คูปอง${typeNames[type]} +${value}% (${durationNum} ${unit === 'min' ? 'นาที' : (unit === 'hour' ? 'ชม.' : 'วัน')})`;
    }

    let icon = '🎟️'; // ค่าเริ่มต้น
    if (type === 'interest') icon = '📈';      // ดอกเบี้ย = กราฟขึ้น
    if (type === 'discount') icon = '🏷️';      // ส่วนลด = ป้ายราคา
    if (type === 'boost') icon = '🚀';         // บูสต์ = จรวด

    // 🔥 สร้าง Object ไอเทม (Dynamic Item)
    const buffItem = {
        id: crypto.randomUUID(), // สร้าง ID ใหม่เลย ไม่ซ้ำกับของในร้าน
        name: customName,
        type: 'buff_coupon',     // ตั้ง Type พิเศษเพื่อให้ระบบรู้
        description: `บัฟพิเศษ: เพิ่ม ${value}% นาน ${durationNum} ${unit}`,
        image: icon,
        
        // ฝังข้อมูลบัฟลงไปในไอเทมเลย
        buff_config: {
            target_stat: type,   // interest, discount, boost
            val: value,
            duration_min: durationMinutes
        },
        
        can_use: true,           // กดใช้ได้
        is_dynamic: true,        // บอกว่าเป็นของที่เสกมา
        acquired_at: new Date()
    };

    try {
        const batch = writeBatch(db);
        let count = 0;

        selectedStudentIds.forEach(sid => {
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', sid);
            
            // ใช้ arrayUnion ยัดไอเทมเข้ากระเป๋า
            batch.update(sRef, {
                inventory: arrayUnion(buffItem)
            });
            
            // บันทึกประวัติ
            const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
            batch.set(hRef, {
                student_id: sid,
                // ต้องหาชื่อนักเรียนจาก ID (สมมติว่าหาได้)
                student_name: students.find(s => s.id === sid)?.full_name || 'Unknown',
                action: `ได้รับคูปอง: ${customName}`,
                amount: 0,
                type: 'system_gift',
                timestamp: serverTimestamp()
            });
            count++;
        });

        await batch.commit();
        showToast(`✅ แจกคูปองให้ ${count} คนเรียบร้อย!`);
        document.getElementById('give-buff-modal').classList.add('hidden');
        
        // Reset Form
        document.getElementById('buff-value-input').value = '';
        document.getElementById('buff-name-input').value = '';

    } catch (e) {
        console.error(e);
        alert('Error: ' + e.message);
    }
};

// ==========================================
// 🎒 ระบบจัดการกระเป๋า (Admin Delete Item)
// ==========================================

// 1. เปิดหน้าต่างจัดการกระเป๋า
window.openAdminInventory = (studentId) => {
    const student = students.find(s => s.id === studentId);
    if (!student) return;

    // ตั้งชื่อหัวข้อ
    document.getElementById('admin-inv-name').innerText = student.full_name;
    
    // ดึงข้อมูลกระเป๋า
    const list = document.getElementById('admin-inv-list');
    const emptyMsg = document.getElementById('admin-inv-empty');
    list.innerHTML = '';

    const inventory = student.inventory || [];

    if (inventory.length === 0) {
        emptyMsg.classList.remove('hidden');
    } else {
        emptyMsg.classList.add('hidden');
        
        // วนลูปสร้างรายการ
        inventory.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = "bg-white p-3 rounded-lg border border-gray-200 shadow-sm flex justify-between items-center hover:shadow-md transition";
            
            // ตกแต่งไอคอนตามประเภท
            let icon = '📦';
            if(item.type?.includes('gacha')) icon = '🎲';
            if(item.is_coupon) icon = '🎫';
            
            let dateDisplay = '-';
            // เช็คว่ามีฟิลด์ acquired_at หรือ bought_at ไหม (เผื่อใช้ชื่อต่างกัน)
            const rawDate = item.acquired_at || item.bought_at; 

            if (rawDate) {
                let dateObj;
                // กรณี 1: เป็น Firebase Timestamp (มี .seconds)
                if (rawDate.seconds) {
                    dateObj = new Date(rawDate.seconds * 1000);
                } 
                // กรณี 2: เป็น Date.now() (ตัวเลข) หรือ String ISO
                else {
                    dateObj = new Date(rawDate);
                }

                // เช็คว่าเป็นวันที่ที่ถูกต้องหรือไม่
                if (!isNaN(dateObj.getTime())) {
                    dateDisplay = dateObj.toLocaleDateString('th-TH', { 
                        day: 'numeric', month: 'short', year: '2-digit' 
                    });
                }
            }

            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl shadow-inner">
                        ${item.image ? `<img src="${item.image}" class="w-full h-full object-cover rounded-full">` : icon}
                    </div>
                    <div>
                        <div class="font-bold text-gray-800 text-sm">${item.name || 'ไอเทมไม่มีชื่อ'}</div>
                        <div class="text-[10px] text-gray-400 flex gap-2">
                             <span>ประเภท: ${item.type || 'ทั่วไป'}</span>
                             <span>• ได้เมื่อ: ${item.acquired_at ? new Date(item.acquired_at.seconds * 1000).toLocaleDateString('th-TH') : '-'}</span>
                        </div>
                    </div>
                </div>
                <button onclick="deleteInventoryItem('${student.id}', ${index}, '${item.name}')" 
                    class="bg-red-50 text-red-500 hover:bg-red-600 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 border border-red-100">
                    🗑️ ลบ
                </button>
            `;
            list.appendChild(div);
        });
    }

    document.getElementById('modal-admin-inventory').classList.remove('hidden');
};

// 2. ปิดหน้าต่าง
window.closeAdminInventory = () => {
    document.getElementById('modal-admin-inventory').classList.add('hidden');
};

// 3. ฟังก์ชันลบไอเทม (Core Logic)
window.deleteInventoryItem = async (studentId, itemIndex, itemName) => {
    // ถามยืนยันก่อนลบ
    const confirmResult = await Swal.fire({
        title: 'ยืนยันการลบ?',
        html: `คุณต้องการลบไอเทม <b>"${itemName}"</b> <br>ออกจากกระเป๋านักเรียนใช่หรือไม่?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#9ca3af',
        confirmButtonText: 'ลบเลย',
        cancelButtonText: 'ยกเลิก'
    });

    if (!confirmResult.isConfirmed) return;

    try {
        showLoading(true);
        const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', studentId);
        
        // ⚠️ ต้องดึงข้อมูลล่าสุดจาก DB ก่อนลบ เพื่อกัน Index เคลื่อน
        const sSnap = await getDoc(sRef);
        if (!sSnap.exists()) throw "ไม่พบข้อมูลนักเรียน";
        
        const currentData = sSnap.data();
        let currentInv = currentData.inventory || [];

        // เช็คว่า Index นั้นยังมีอยู่ไหม
        if (!currentInv[itemIndex]) {
            throw "ไม่พบไอเทม (อาจถูกลบไปแล้ว)";
        }

        // 🗑️ ตัดไอเทมออกจาก Array
        currentInv.splice(itemIndex, 1);

        // บันทึกกลับ
        await updateDoc(sRef, { inventory: currentInv });

        showLoading(false);
        closeAdminInventory(); // ปิดหน้าต่างก่อน (เพื่อให้โหลดใหม่รอบหน้า)
        
        Swal.fire({
            icon: 'success',
            title: 'ลบเรียบร้อย',
            timer: 1500,
            showConfirmButton: false
        });

    } catch (e) {
        console.error(e);
        showLoading(false);
        Swal.fire('Error', 'เกิดข้อผิดพลาด: ' + e.message, 'error');
    }
};

// ==========================================
// 🤝 ระบบบริจาคกองทุนกิลด์ (Guild Fund)
// ==========================================

let currentStudentForDonate = null;

// 1. เปิด Modal บริจาค
window.openDonateGuildModal = (studentId) => {
    const student = students.find(s => s.id === studentId);
    if (!student) return;

    // เช็คว่ามีกิลด์ไหม?
    if (!student.guild_id) {
        return Swal.fire('ไม่พบกิลด์', 'นักเรียนคนนี้ยังไม่มีสังกัดกิลด์ครับ', 'warning');
    }

    const guild = guilds.find(g => g.id === student.guild_id);
    const guildName = guild ? guild.name : 'ไม่ทราบชื่อกิลด์';

    currentStudentForDonate = student;

    // Set ค่าใน Modal
    document.getElementById('donate-guild-subtitle').innerHTML = `บริจาคในนาม: <b>${student.full_name}</b><br>เข้าสู่กิลด์: <span class="text-amber-600">${guildName}</span>`;
    document.getElementById('donate-student-points').innerText = Math.floor(student.points || 0).toLocaleString();
    document.getElementById('guild-donate-amount').value = '';

    document.getElementById('modal-donate-guild').classList.remove('hidden');
    document.getElementById('modal-donate-guild').classList.add('flex');
    
    // Auto Focus ช่องกรอก
    setTimeout(() => document.getElementById('guild-donate-amount').focus(), 100);
};

// 2. ยืนยันการบริจาค
window.confirmDonateGuild = async () => {
    if (!currentStudentForDonate) return;

    const amount = parseInt(document.getElementById('guild-donate-amount').value);
    
    // Validation
    if (isNaN(amount) || amount <= 0) {
        return Swal.fire('แจ้งเตือน', 'กรุณาระบุจำนวนแต้มให้ถูกต้อง', 'warning');
    }
    if (amount > currentStudentForDonate.points) {
        return Swal.fire('แต้มไม่พอ', 'นักเรียนมีแต้มไม่เพียงพอสำหรับการบริจาค', 'error');
    }

    try {
        showLoading(true);
        const batch = writeBatch(db);
        
        // 1. หักเงินนักเรียน
        const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', currentStudentForDonate.id);
        batch.update(sRef, { points: increment(-amount) });

        // 2. เพิ่มเงินเข้ากองทุนกิลด์
        const gRef = doc(db, 'artifacts', appId, 'public', 'data', 'guilds', currentStudentForDonate.guild_id);
        batch.update(gRef, { fund_points: increment(amount) });

        // 3. บันทึกประวัติ
        const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
        batch.set(hRef, {
            student_id: currentStudentForDonate.id,
            student_name: currentStudentForDonate.full_name,
            action: 'บริจาคกิลด์',
            amount: -amount,
            type: 'guild_donate',
            timestamp: serverTimestamp()
        });

        await batch.commit();
        showLoading(false);

        // ปิด Modal และแจ้งเตือน
        document.getElementById('modal-donate-guild').classList.add('hidden');
        document.getElementById('modal-donate-guild').classList.remove('flex');
        
        Swal.fire({
            icon: 'success',
            title: 'บริจาคสำเร็จ! 🤝',
            html: `บริจาค <b>${amount.toLocaleString()}</b> แต้ม<br>เข้าสู่กองทุนกิลด์เรียบร้อยแล้ว`,
            timer: 2000,
            showConfirmButton: false
        });

    } catch (e) {
        console.error(e);
        showLoading(false);
        Swal.fire('Error', 'เกิดข้อผิดพลาด: ' + e.message, 'error');
    }
};

// ==========================================
// 🏰 GUILD SHOP & INVENTORY SYSTEM (Updated)
// ==========================================

let currentGuildForShop = null;

// --- 1. ADMIN: จัดการสินค้า (คงเดิม) ---
window.openGuildShopManager = () => {
    renderGuildShopAdminList();
    document.getElementById('modal-guild-shop-manager').classList.remove('hidden');
    document.getElementById('modal-guild-shop-manager').classList.add('flex');
};
// ... (ฟังก์ชัน renderGuildShopAdminList, saveGuildShopItem ใช้ของเดิมได้เลยครับ ไม่ต้องแก้) ...
// ==========================================
// 🛠️ ฟังก์ชันแสดงรายการสินค้ากิลด์ (ฝั่ง Admin)
// ==========================================
window.renderGuildShopAdminList = () => {
    // 1. หา Element ปลายทาง
    const container = document.getElementById('guild-shop-admin-list');
    if (!container) return;

    // 2. กรองเฉพาะสินค้าที่เป็น "ร้านค้ากิลด์" (shop_type === 'guild')
    // (ตัวแปร rewards คือตัวแปร Global ที่เก็บสินค้าทั้งหมดในระบบ)
    const guildItems = rewards.filter(r => r.shop_type === 'guild');
    
    // 3. กรณีไม่มีสินค้า
    if (guildItems.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-10 flex flex-col items-center"><span class="text-4xl mb-2">🍃</span><span>ยังไม่มีสินค้าในร้านกิลด์</span></div>';
        return;
    }

    // 4. วาด HTML รายการสินค้า
    container.innerHTML = guildItems.map(item => {
        // จัดรูปแบบการแสดงผล (ถ้าเป็นบัฟ โชว์ค่าพลัง / ถ้าเป็นไอเทม โชว์คำว่าไอเทม)
        let detailText = '';
        if (item.type === 'guild_item') {
            detailText = '📦 ไอเทมทั่วไป';
        } else {
            const unit = item.type.includes('interest') ? '%' : '%'; // หน่วย (ดอกเบี้ย หรือ บูสต์)
            const durationHrs = item.duration ? (item.duration / 3600000).toFixed(1) : 0;
            detailText = `⚡ บัฟ: +${item.value}${unit} (${durationHrs} ชม.)`;
        }

        return `
        <div class="bg-white p-3 rounded-lg border border-gray-200 shadow-sm flex gap-3 relative group hover:border-amber-300 transition-all">
            <div class="w-14 h-14 bg-gray-100 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center border">
                ${item.image ? `<img src="${item.image}" class="w-full h-full object-cover">` : `<span class="text-2xl">🏰</span>`}
            </div>

            <div class="flex-1 min-w-0">
                <div class="font-bold text-gray-800 text-sm truncate pr-6">${item.name}</div>
                <div class="text-xs text-amber-600 font-bold mt-0.5">💰 ${item.points.toLocaleString()} กองทุน</div>
                <div class="text-[10px] text-gray-400 mt-1 bg-gray-50 inline-block px-1.5 rounded">
                    ${detailText}
                </div>
            </div>

            <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white shadow-sm rounded-md p-1 border">
                <button onclick="editGuildShopItem('${item.id}')" class="text-blue-500 hover:bg-blue-50 p-1 rounded transition" title="แก้ไข">
                    ✏️
                </button>
                <button onclick="deleteReward('${item.id}')" class="text-red-500 hover:bg-red-50 p-1 rounded transition" title="ลบ">
                    🗑️
                </button>
            </div>
        </div>
        `;
    }).join('');
};

window.toggleGuildShopInputs = () => {
    const type = document.getElementById('gs-type').value;
    const config = document.getElementById('gs-buff-config');
    if (type === 'guild_item') config.classList.add('hidden');
    else config.classList.remove('hidden');
};

window.saveGuildShopItem = async () => {
    const id = document.getElementById('gs-edit-id').value;
    const name = document.getElementById('gs-name').value;
    const price = parseInt(document.getElementById('gs-price').value) || 0;
    const stock = parseInt(document.getElementById('gs-stock').value) || -1;
    const type = document.getElementById('gs-type').value;
    const image = document.getElementById('gs-image').value;

    // คำนวณเวลาและค่าพลัง
    const val = parseFloat(document.getElementById('gs-value').value) || 0;
    const durationNum = parseInt(document.getElementById('gs-duration').value) || 0;
    const unit = document.getElementById('gs-unit').value;
    
    let durationMS = 0;
    if (durationNum > 0) {
        durationMS = durationNum * (unit === 'hour' ? 3600000 : 86400000);
    }

    if (!name || price < 0) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณาระบุชื่อและราคา', 'error');

    const data = {
        name,
        points: price, // ใช้ field points แต่ในบริบทนี้คือ fund_points
        stock,
        type,
        image,
        value: val,
        duration: durationMS,
        shop_type: 'guild', // 🚩 Flag สำคัญเพื่อแยกจากร้านปกติ
        updated_at: serverTimestamp()
    };

    showLoading(true);
    try {
        if (id) {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rewards', id), data);
        } else {
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'rewards'), {
                ...data,
                created_at: serverTimestamp()
            });
        }
        resetGuildShopForm();
        renderGuildShopAdminList(); // Refresh list immediately
        showToast('บันทึกสินค้ากิลด์แล้ว');

        setTimeout(() => {
            if(typeof renderGuildShopAdminList === 'function') {
                renderGuildShopAdminList();
            }
        }, 500);
    } catch (e) {
        console.error(e);
        Swal.fire('Error', e.message, 'error');
    } finally {
        showLoading(false);
    }
};

window.editGuildShopItem = (id) => {
    const item = rewards.find(r => r.id === id);
    if (!item) return;
    
    document.getElementById('gs-edit-id').value = item.id;
    document.getElementById('gs-name').value = item.name;
    document.getElementById('gs-price').value = item.points;
    document.getElementById('gs-stock').value = item.stock;
    document.getElementById('gs-type').value = item.type;
    document.getElementById('gs-image').value = item.image || '';
    document.getElementById('gs-value').value = item.value || 0;
    
    // แปลงเวลาคืนเป็นหน่วยที่ใกล้เคียง
    if (item.duration >= 86400000) {
        document.getElementById('gs-duration').value = item.duration / 86400000;
        document.getElementById('gs-unit').value = 'day';
    } else {
        document.getElementById('gs-duration').value = (item.duration / 3600000) || 1;
        document.getElementById('gs-unit').value = 'hour';
    }
    toggleGuildShopInputs();
};

window.resetGuildShopForm = () => {
    document.getElementById('gs-edit-id').value = '';
    document.getElementById('gs-name').value = '';
    document.getElementById('gs-price').value = '';
    document.getElementById('gs-stock').value = '-1';
    document.getElementById('gs-image').value = '';
};

// --- 2. USER: หน้าร้านค้า ---

window.openGuildStore = (guildId) => {
    // 1. หาข้อมูลกิลด์
    currentGuildForShop = guilds.find(g => g.id === guildId);
    if (!currentGuildForShop) return;

    // 2. อัปเดต Header
    document.getElementById('store-guild-name').innerText = currentGuildForShop.name;
    document.getElementById('store-guild-fund').innerText = (currentGuildForShop.fund_points || 0).toLocaleString();

    // 3. เริ่มต้นที่แท็บร้านค้าเสมอ
    switchGuildStoreTab('shop');
    
    // 4. เปิด Modal
    document.getElementById('modal-guild-store').classList.remove('hidden');
    document.getElementById('modal-guild-store').classList.add('flex');
};

// ฟังก์ชันสลับแท็บ
window.switchGuildStoreTab = (tab) => {
    const btnShop = document.getElementById('tab-guild-shop');
    const btnInv = document.getElementById('tab-guild-inv');
    const divShop = document.getElementById('guild-store-grid');
    const divInv = document.getElementById('guild-inventory-grid');
    const divEmpty = document.getElementById('guild-inventory-empty');

    if (tab === 'shop') {
        // Active Shop
        btnShop.className = "flex-1 py-3 text-sm font-bold text-amber-600 border-b-2 border-amber-600 bg-amber-50 transition-colors";
        btnInv.className = "flex-1 py-3 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-colors";
        divShop.classList.remove('hidden');
        divInv.classList.add('hidden');
        divEmpty.classList.add('hidden');
        renderGuildStoreItems(); // วาดรายการสินค้า
    } else {
        // Active Inventory
        btnInv.className = "flex-1 py-3 text-sm font-bold text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50 transition-colors";
        btnShop.className = "flex-1 py-3 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-colors";
        divShop.classList.add('hidden');
        divInv.classList.remove('hidden');
        renderGuildInventoryItems(); // วาดของในกระเป๋า
    }
};

// แสดงรายการสินค้าขาย
window.renderGuildStoreItems = () => {
    const container = document.getElementById('guild-store-grid');
    const shopItems = rewards.filter(r => r.shop_type === 'guild');

    container.innerHTML = shopItems.map(item => {
        const canAfford = (currentGuildForShop.fund_points || 0) >= item.points;
        const hasStock = item.stock === -1 || item.stock > 0;
        const disabled = !canAfford || !hasStock;
        
        return `
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col justify-between hover:shadow-lg transition">
            <div class="h-32 bg-gray-50 rounded-lg mb-3 overflow-hidden flex items-center justify-center relative">
                ${item.image ? `<img src="${item.image}" class="w-full h-full object-cover">` : `<span class="text-4xl">📦</span>`}
                ${!hasStock ? '<div class="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-bold">สินค้าหมด</div>' : ''}
            </div>
            <div>
                <h4 class="font-bold text-gray-800 line-clamp-1">${item.name}</h4>
                <div class="flex justify-between items-center mt-1">
                    <span class="text-amber-600 font-bold">💰 ${item.points.toLocaleString()}</span>
                    <span class="text-xs text-gray-400">คลัง: ${item.stock === -1 ? '∞' : item.stock}</span>
                </div>
            </div>
            <button onclick="buyGuildItem('${item.id}')" ${disabled ? 'disabled' : ''} 
                class="w-full mt-3 py-2 rounded-lg font-bold text-sm text-white transition-all transform active:scale-95 
                ${disabled ? 'bg-gray-300 cursor-not-allowed' : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30 shadow-lg'}">
                ${!canAfford ? 'กองทุนไม่พอ' : (!hasStock ? 'หมด' : 'ซื้อเก็บไว้')}
            </button>
        </div>`;
    }).join('') || '<div class="col-span-full text-center text-gray-400 py-10">ร้านค้าปิดปรับปรุง</div>';
};

// แสดงของในกระเป๋า
window.renderGuildInventoryItems = () => {
    const container = document.getElementById('guild-inventory-grid');
    const emptyState = document.getElementById('guild-inventory-empty');
    
    // ดึงข้อมูลกิลด์ล่าสุด (เผื่อมีของใหม่)
    const g = guilds.find(x => x.id === currentGuildForShop.id);
    const inventory = g.inventory || []; // รายการของที่ซื้อไว้
    
    // อัปเดต Badge จำนวนของ
    const badge = document.getElementById('guild-inv-badge');
    if(inventory.length > 0) {
        badge.innerText = inventory.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }

    if (inventory.length === 0) {
        container.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    container.innerHTML = inventory.map(item => {
        // เช็คประเภทเพื่อเลือกไอคอน
        const isBuff = item.type && item.type.includes('buff');
        const icon = isBuff ? (item.type.includes('interest') ? '📈' : '🚀') : '📦';
        const date = item.obtained_at ? new Date(item.obtained_at.seconds * 1000).toLocaleDateString('th-TH') : '-';

        return `
        <div class="bg-white rounded-xl shadow-sm border border-indigo-100 p-4 flex gap-4 items-center hover:shadow-md transition relative overflow-hidden">
            <div class="absolute left-0 top-0 bottom-0 w-1 ${isBuff ? 'bg-indigo-500' : 'bg-gray-400'}"></div>
            
            <div class="w-14 h-14 bg-indigo-50 rounded-lg flex items-center justify-center text-2xl flex-shrink-0">
                ${item.image ? `<img src="${item.image}" class="w-full h-full object-cover rounded-lg">` : icon}
            </div>
            
            <div class="flex-1">
                <h4 class="font-bold text-gray-800 text-sm line-clamp-1">${item.name}</h4>
                <div class="text-xs text-gray-500 mt-0.5">ได้เมื่อ: ${date}</div>
                ${isBuff ? `<div class="text-[10px] text-indigo-600 font-bold bg-indigo-50 inline-block px-1.5 rounded mt-1">พลัง: +${item.value}${item.type.includes('interest')?'%':'%'}</div>` : ''}
            </div>

            <button onclick="useGuildItem('${item.id}')" 
                class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-indigo-500/30 shadow-md transition transform hover:scale-105 active:scale-95">
                ใช้ทันที
            </button>
        </div>`;
    }).join('');
};


// --- 3. ACTIONS: ซื้อ และ ใช้ ---

// A. ฟังก์ชันซื้อ (เปลี่ยนจาก Active เลย -> เป็นเก็บลงกระเป๋า)
window.buyGuildItem = async (itemId) => {
    if (!currentGuildForShop) return;
    const item = rewards.find(r => r.id === itemId);
    if (!item) return;

    if ((currentGuildForShop.fund_points || 0) < item.points) {
        return Swal.fire('แจ้งเตือน', 'กองทุนกิลด์ไม่พอครับ', 'warning');
    }

    const confirm = await Swal.fire({
        title: 'ยืนยันการซื้อ',
        html: `ซื้อ <b>"${item.name}"</b> เก็บเข้ากระเป๋ากิลด์?<br>ราคา: <span class="text-amber-600 font-bold">${item.points.toLocaleString()}</span> แต้ม`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'ซื้อเก็บไว้',
        confirmButtonColor: '#f59e0b'
    });

    if (!confirm.isConfirmed) return;

    showLoading(true);
    try {
        await runTransaction(db, async (transaction) => {
            const gRef = doc(db, 'artifacts', appId, 'public', 'data', 'guilds', currentGuildForShop.id);
            const rRef = doc(db, 'artifacts', appId, 'public', 'data', 'rewards', item.id);
            
            const gDoc = await transaction.get(gRef);
            const rDoc = await transaction.get(rRef);
            if (!gDoc.exists() || !rDoc.exists()) throw "Data missing";

            const gData = gDoc.data();
            const rData = rDoc.data();

            if (gData.fund_points < rData.points) throw "เงินไม่พอ";
            if (rData.stock !== -1 && rData.stock <= 0) throw "สินค้าหมด";

            // 1. หักเงินกองทุน
            transaction.update(gRef, { fund_points: increment(-rData.points) });

            // 2. ตัดสต็อก
            if (rData.stock !== -1) {
                transaction.update(rRef, { stock: increment(-1) });
            }

            // 3. สร้าง Item Object (เหมือนคูปอง)
            const newItem = {
                id: crypto.randomUUID(), // ID ของคูปองใบนี้
                reward_id: item.id,
                name: item.name,
                type: item.type,       // guild_buff_interest, etc.
                value: item.value || 0,
                duration: item.duration || 0,
                image: item.image || '',
                obtained_at: new Date()
            };

            // 4. ยัดเข้ากระเป๋ากิลด์ (Inventory)
            transaction.update(gRef, { 
                inventory: arrayUnion(newItem) 
            });

            // 5. บันทึกประวัติ
            const hRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'history'));
            transaction.set(hRef, {
                guild_id: currentGuildForShop.id,
                guild_name: gData.name,
                action: `กิลด์ซื้อ: ${item.name}`,
                amount: -rData.points,
                type: 'guild_purchase',
                timestamp: serverTimestamp()
            });
        });

        showLoading(false);
        Swal.fire({
            icon: 'success',
            title: 'ซื้อสำเร็จ!',
            html: 'ของอยู่ใน <b>กระเป๋ากิลด์</b> แล้ว<br>กดใช้เมื่อต้องการบัฟ',
            timer: 2000,
            showConfirmButton: false
        });

        // อัปเดต UI ทันที (ไม่ต้องปิด Modal)
        const updatedGuild = guilds.find(g => g.id === currentGuildForShop.id);
        if(updatedGuild) {
            document.getElementById('store-guild-fund').innerText = (updatedGuild.fund_points || 0).toLocaleString();
            renderGuildStoreItems();
            
            // แจ้งเตือน Badge ที่แท็บกระเป๋า
            const invCount = (updatedGuild.inventory || []).length;
            const badge = document.getElementById('guild-inv-badge');
            if(invCount > 0) { badge.innerText = invCount; badge.classList.remove('hidden'); }
        }
       

    } catch (e) {
        console.error(e);
        showLoading(false);
        Swal.fire('Error', e.message, 'error');
    }
};


// B. ฟังก์ชันใช้ไอเทม (กดจากกระเป๋ากิลด์ -> บัฟทำงาน)
window.useGuildItem = async (itemUuid) => {
    if (!currentGuildForShop) return;
    
    // หาไอเทมในกระเป๋า (Client-side check)
    const g = guilds.find(x => x.id === currentGuildForShop.id);
    const item = (g.inventory || []).find(i => i.id === itemUuid);
    if (!item) return;

    const confirm = await Swal.fire({
        title: 'เปิดใช้งานบัฟ?',
        html: `ต้องการใช้ <b>"${item.name}"</b> ตอนนี้เลยหรือไม่?<br><span class="text-sm text-gray-500">ผลบัฟจะบวกทบกับบัฟเดิมที่มีอยู่</span>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '🚀 ใช้เลย',
        confirmButtonColor: '#4f46e5'
    });

    if (!confirm.isConfirmed) return;

    showLoading(true);
    try {
        await runTransaction(db, async (transaction) => {
            const gRef = doc(db, 'artifacts', appId, 'public', 'data', 'guilds', currentGuildForShop.id);
            const gDoc = await transaction.get(gRef);
            if (!gDoc.exists()) throw "Guild not found";
            
            const gData = gDoc.data();
            const currentInv = gData.inventory || [];
            
            // เช็คว่าไอเทมยังมีอยู่ไหม (กันคนกดพร้อมกัน)
            const itemInDb = currentInv.find(i => i.id === itemUuid);
            if (!itemInDb) throw "ไอเทมถูกใช้ไปแล้ว";

            // --- Logic คำนวณ Stack Buff ---
            if (item.type.includes('buff')) {
                const now = Date.now();
                let buffKey = (item.type === 'guild_buff_interest') ? 'interest' : 'point_boost';
                let currentBuffs = gData.active_buffs || {};
                
                let currentVal = 0;
                // ถ้าบัฟเก่ายังไม่หมดอายุ ให้เอาค่ามาบวก
                if (currentBuffs[buffKey] && currentBuffs[buffKey].end_time > now) {
                    currentVal = parseFloat(currentBuffs[buffKey].value) || 0;
                }
                
                const newVal = currentVal + (parseFloat(item.value) || 0);
                const newDuration = parseInt(item.duration) || 86400000;
                
                // อัปเดต Active Buffs
                const updatedBuffs = {
                    ...currentBuffs,
                    [buffKey]: {
                        value: newVal,
                        end_time: now + newDuration, // ต่อเวลาใหม่
                        last_updated: now
                    }
                };
                transaction.update(gRef, { active_buffs: updatedBuffs });
            }

            // --- ลบออกจากกระเป๋า ---
            const newInv = currentInv.filter(i => i.id !== itemUuid);
            transaction.update(gRef, { inventory: newInv });

            // บันทึกประวัติการใช้
            const hRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'history'));
            transaction.set(hRef, {
                guild_id: currentGuildForShop.id,
                guild_name: gData.name,
                action: `กิลด์ใช้บัฟ: ${item.name}`,
                amount: 0,
                type: 'guild_use_item',
                timestamp: serverTimestamp()
            });
        });

        showLoading(false);
        Swal.fire('สำเร็จ', 'บัฟกิลด์ทำงานแล้ว! 🚀', 'success');

        if (typeof renderGuildInventoryItems === 'function') renderGuildInventoryItems(); // รีเฟรชกระเป๋า (ไอเทมต้องหายไป)
        if (typeof updateGuildStoreUI === 'function') updateGuildStoreUI(); // รีเฟรช UI (เผื่อมีแสดงสถานะบัฟ)
        
        // รีเฟรชหน้ากระเป๋า
        switchGuildStoreTab('inventory');

    } catch (e) {
        console.error(e);
        showLoading(false);
        Swal.fire('Error', e.message, 'error');
    }
};

// ==========================================
// 👹 BOSS SYSTEM (ระบบบอส)
// ==========================================
let bossListener = null;
let currentBossData = null;
let bossTimerInterval = null;

window.initBossSystem = () => {
    if (bossListener) return;
    
    const bossRef = doc(db, 'artifacts', appId, 'public', 'data', 'system_goals', 'current_boss');
    
    bossListener = onSnapshot(bossRef, (docSnap) => {
        // ID Elements ต่างๆ ในหน้า Tab ใหม่
        const createForm = document.getElementById('create-boss-form');
        const activeControls = document.getElementById('active-boss-controls');
        const bossWidget = document.getElementById('boss-widget-container'); // ของเด็ก

        if (docSnap.exists() && docSnap.data().active) {
            currentBossData = docSnap.data();

            // ==========================================
            // 💥💥💥 ระบบแอนิเมชันตอนบอสโดนดาเมจ 💥💥💥
            // ==========================================
            if (typeof window.previousBossHp !== 'undefined' && window.previousBossHp !== null) {
                const currentHp = currentBossData.current_hp;
                
                // ถ้าเลือดลดลง (และบอสยังไม่ตาย เพราะตอนตายมีปุ่มให้กดแล้ว)
                if (currentHp < window.previousBossHp && currentHp > 0) {
                    const damageTaken = window.previousBossHp - currentHp;
                    
                    // เด้ง Popup มุมขวาบน (Toast) เพื่อไม่ให้รบกวนการคลิกของครู
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        imageUrl: 'https://cdn-icons-png.flaticon.com/512/11582/11582155.png', // รูปเอฟเฟกต์การโจมตี
                        imageWidth: 40,
                        title: 'BOOM!',
                        text: `บอสโดนโจมตี -${damageTaken.toLocaleString()} HP`,
                        showConfirmButton: false,
                        timer: 2500,
                        timerProgressBar: true,
                        background: '#1f2937', // พื้นหลังสีเทาเข้มดูดุดัน
                        color: '#f87171', // ตัวหนังสือสีแดง
                    });
                }
            }
            // อัปเดตเลือดล่าสุดเก็บไว้เทียบในรอบถัดไป
            window.previousBossHp = currentBossData.current_hp;
            
            // 1. สลับหน้าจอ: ซ่อนฟอร์ม -> โชว์แผงควบคุม
            if(createForm) createForm.classList.add('hidden');
            if(activeControls) activeControls.classList.remove('hidden');

            // 2. อัปเดตข้อมูลบนหน้า Admin
            setText('admin-boss-name', currentBossData.name);
            setText('admin-boss-hp-text', `${currentBossData.current_hp.toLocaleString()} / ${currentBossData.max_hp.toLocaleString()}`);
            setText('admin-boss-ratio-show', currentBossData.damage_ratio || 1);
            
            // Update HP Bar
            const percent = Math.max(0, (currentBossData.current_hp / currentBossData.max_hp) * 100);
            const bar = document.getElementById('admin-boss-hp-bar');
            if(bar) bar.style.width = `${percent}%`;

            // Update Image
            const img = document.getElementById('admin-boss-img-preview');
            if(img) img.src = currentBossData.image || 'https://cdn-icons-png.flaticon.com/512/3062/3062634.png';

            // ==========================================
            // 🔥🔥🔥 ส่วนที่เพิ่มใหม่: โชว์ของรางวัลและบทลงโทษ 🔥🔥🔥
            // ==========================================
            // แสดงแต้มชนะ / แพ้
            setText('admin-boss-reward-show', currentBossData.win_reward || currentBossData.reward || 0);
            setText('admin-boss-penalty-show', currentBossData.penalty || currentBossData.lose_penalty || 0);

            // จัดการแสดงชื่อไอเทมดรอป (รองรับทั้งแบบ ID และแบบ Object)
            let dropName = "ไม่มี";
            if (currentBossData.drop_item) {
                if (typeof currentBossData.drop_item === 'string') {
                    const foundItem = (window.rewards || []).find(r => r.id === currentBossData.drop_item);
                    dropName = foundItem ? foundItem.name : "ไอเทมลึกลับ";
                } else if (typeof currentBossData.drop_item === 'object') {
                    dropName = currentBossData.drop_item.name || "ไอเทมลึกลับ";
                }
            }
            setText('admin-boss-drop-show', dropName);
            // ==========================================

            // 3. อัปเดตตารางคนตีบอส (Contributors)
            if (typeof renderBossContributors === 'function') {
                renderBossContributors(currentBossData.contributors);
            }

            // 4. อัปเดตหน้าเด็ก (ถ้ามี)
            if(bossWidget) {
                bossWidget.classList.remove('hidden');
                if (typeof renderBossWidget === 'function') {
                    renderBossWidget(currentBossData);
                }
            }
            
            if (typeof startBossTimer === 'function') startBossTimer(); 
            if (typeof loadManualAttackers === 'function') loadManualAttackers();

            // ==========================================
            // 🔥🔥🔥 ตรวจจับเมื่อบอสเลือดหมด (สลับ UI ให้ครูกดปุ่ม) 🔥🔥🔥
            // ==========================================
            if (currentBossData.current_hp <= 0) {
                // 1. หยุดเวลา
                if (window.bossTimerInterval) clearInterval(window.bossTimerInterval);

                // 2. สลับหน้าจอ: ปิดปุ่มตี -> โชว์ปุ่มแจกรางวัล
                const aliveUI = document.getElementById('boss-alive-controls');
                const deadUI = document.getElementById('boss-dead-controls');
                if(aliveUI) aliveUI.classList.add('hidden');
                if(deadUI) deadUI.classList.remove('hidden');

                // 3. แจ้งเตือนนักเรียน (โชว์ครั้งเดียว)
                if (window.userRole === 'student' && !window.isBossDefeatedAlertShown) {
                    window.isBossDefeatedAlertShown = true;
                    Swal.fire({
                        title: 'Victory! ⚔️',
                        text: 'บอสถูกกำจัดแล้ว! รอคุณครูกดแจกรางวัลนะ',
                        icon: 'success',
                        timer: 4000
                    });
                }
            } else {
                // กรณีเลือดบอสยังมากกว่า 0 (หรือโดนฮีลกลับมา)
                const aliveUI = document.getElementById('boss-alive-controls');
                const deadUI = document.getElementById('boss-dead-controls');
                if(aliveUI) aliveUI.classList.remove('hidden');
                if(deadUI) deadUI.classList.add('hidden');
                
                window.isBossDefeatedAlertShown = false;
            }
            // ==========================================

        } else {
            // กรณีไม่มีบอส
            currentBossData = null;
            if(createForm) createForm.classList.remove('hidden');
            if(activeControls) activeControls.classList.add('hidden');
            if(bossWidget) bossWidget.classList.add('hidden');
            
            if (window.bossTimerInterval) clearInterval(window.bossTimerInterval);
            window.isBossDefeatedAlertShown = false; // เคลียร์สถานะตอนบอสถูกลบ
            window.previousBossHp = null;
        }
    });
};

// ==========================================
// 📋 ฟังก์ชันโหลดรายชื่อนักเรียน (เรียง selected ไว้บน)
// ==========================================
window.loadManualAttackers = () => {
    const container = document.getElementById('manual-attacker-list');
    const countDisplay = document.getElementById('manual-selected-count');
    
    if (!container) return;

    // 🔥 1. ตั้งค่า Container ให้เป็น Flex Column เพื่อให้ใช้ property 'order' ได้
    container.className = "h-48 overflow-y-auto p-1 space-y-1 bg-white flex flex-col";

    // ดึงข้อมูล (Global หรือ Local)
    let data = [];
    if (typeof window.students !== 'undefined' && window.students.length > 0) {
        data = window.students;
    } else if (typeof students !== 'undefined' && students.length > 0) {
        data = students;
    }

    if (data.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 text-xs py-4">ไม่พบข้อมูลนักเรียน</p>';
        return;
    }

    // เรียงตามเลขที่
    const sortedStudents = [...data].sort((a, b) => 
        (a.student_id || '').localeCompare(b.student_id || '')
    );

    let html = '';
    sortedStudents.forEach(s => {
        const avatar = s.profile_image || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';
        
        // สังเกต style="order: 0" คือลำดับปกติ
        html += `
            <label class="manual-student-item flex items-center gap-3 p-2 hover:bg-indigo-50 rounded-lg cursor-pointer border border-transparent hover:border-indigo-100 transition-all select-none border-b border-gray-100 last:border-0" style="order: 0">
                <input type="checkbox" value="${s.id}" class="manual-attacker-checkbox w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 flex-shrink-0" onchange="updateManualCount()">
                
                <div class="flex items-center gap-3 w-full overflow-hidden">
                    <img src="${avatar}" class="w-8 h-8 rounded-full object-cover bg-gray-200 flex-shrink-0">
                    <div class="flex flex-col leading-tight min-w-0">
                        <span class="text-xs font-bold text-gray-500 truncate">${s.student_id || 'ไม่ระบุ'}</span>
                        <span class="text-sm font-medium text-gray-800 truncate student-name">${s.full_name}</span>
                    </div>
                </div>
            </label>
        `;
    });

    container.innerHTML = html;
    if(countDisplay) countDisplay.textContent = '0';
};

// 👇 ฟังก์ชันช่วย: กรองรายชื่อ (Search)
window.filterManualAttackers = () => {
    const input = document.getElementById('manual-search-input');
    const filter = input.value.toLowerCase();
    const items = document.querySelectorAll('.manual-student-item');

    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(filter)) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
};

// 👇 ฟังก์ชันช่วย: เลือกทั้งหมด / ล้าง
window.toggleSelectAllManual = (selectAll) => {
    const checkboxes = document.querySelectorAll('.manual-attacker-checkbox');
    // เลือกเฉพาะตัวที่มองเห็นอยู่ (เผื่อกรองค้นหาอยู่)
    checkboxes.forEach(cb => {
        if (!cb.closest('.manual-student-item').classList.contains('hidden')) {
            cb.checked = selectAll;
        }
    });
    updateManualCount();
};

// ==========================================
// 🔄 ฟังก์ชันอัปเดตจำนวน + ย้ายคนที่เลือกไปไว้บนสุด
// ==========================================
window.updateManualCount = () => {
    const checkboxes = document.querySelectorAll('.manual-attacker-checkbox');
    let count = 0;

    checkboxes.forEach(cb => {
        // หาตัว Parent (label) ของ checkbox นี้
        const parentRow = cb.closest('.manual-student-item');
        
        if (cb.checked) {
            count++;
            // 🔥 เทคนิคเด็ด: ย้ายไปบนสุดด้วย order: -1
            parentRow.style.order = "-1"; 
            
            // เปลี่ยนสีให้รู้ว่าเลือกแล้ว
            parentRow.classList.add('bg-indigo-50', 'border-indigo-200');
            parentRow.classList.remove('border-transparent');
        } else {
            // คืนค่าเดิม (order: 0)
            parentRow.style.order = "0"; 
            
            // คืนสีเดิม
            parentRow.classList.remove('bg-indigo-50', 'border-indigo-200');
            parentRow.classList.add('border-transparent');
        }
    });

    const display = document.getElementById('manual-selected-count');
    if(display) display.textContent = count;
};

// 👇 ฟังก์ชันช่วยแสดงรายชื่อคนตี (Helper Function)
function renderBossContributors(contributors) {
    const listEl = document.getElementById('boss-contributors-list');
    if(!listEl) return;

    if (!contributors || Object.keys(contributors).length === 0) {
        listEl.innerHTML = '<p class="text-center text-gray-400 py-10 text-sm">ยังไม่มีดาเมจ</p>';
        return;
    }

    // แปลง Map เป็น Array -> เรียงตามดาเมจมากไปน้อย
    const sorted = Object.entries(contributors)
        .map(([id, dmg]) => ({ id, dmg }))
        .sort((a, b) => b.dmg - a.dmg);

    listEl.innerHTML = sorted.map((c, i) => {
        // หาชื่อนักเรียนจาก Array students (ถ้าโหลดไว้แล้ว)
        const student = students.find(s => s.id === c.id);
        const name = student ? student.full_name : 'Unknown Student';
        const rankColor = i === 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-50 text-gray-600';
        
        return `
            <div class="flex justify-between items-center p-2 rounded-lg ${rankColor} text-sm">
                <div class="flex items-center gap-2">
                    <span class="font-bold w-5 text-center">${i+1}</span>
                    <span class="truncate max-w-[120px] font-medium">${name}</span>
                </div>
                <span class="font-bold">⚔️ ${c.dmg.toLocaleString()}</span>
            </div>
        `;
    }).join('');
}

// Helper เล็กๆ สำหรับเปลี่ยน text
function setText(id, text) {
    const el = document.getElementById(id);
    if(el) el.textContent = text;
}
// 2. แสดงผล Widget
function renderBossWidget(data) {
    document.getElementById('boss-name-show').textContent = data.name;
    document.getElementById('boss-reward-show').textContent = data.reward;
    document.getElementById('boss-penalty-show').textContent = data.penalty;
    
    // รูปภาพ (ถ้าไม่มีรูป ใช้รูป Default)
    const defaultBossImg = 'https://cdn-icons-png.flaticon.com/512/3062/3062634.png';
    document.getElementById('boss-image-show').src = data.image || defaultBossImg;

    // HP Bar
    const hpPercent = Math.max(0, (data.current_hp / data.max_hp) * 100);
    document.getElementById('boss-hp-bar').style.width = `${hpPercent}%`;
    document.getElementById('boss-hp-text').textContent = `${data.current_hp.toLocaleString()} / ${data.max_hp.toLocaleString()}`;
    
    // เปลี่ยนสี HP Bar ตามความวิกฤต
    const bar = document.getElementById('boss-hp-bar');
    if(hpPercent < 30) bar.className = "h-full bg-red-600 animate-pulse";
    else bar.className = "h-full bg-gradient-to-r from-red-600 via-orange-500 to-red-600";
}

// ==========================================
// ⏱️ ฟังก์ชันนับถอยหลังเวลาบอส (Timer)
// ==========================================
window.startBossTimer = () => {
    // เคลียร์ Interval เก่าก่อนเริ่มใหม่เสมอ (กันตัวเลขนับซ้อนกัน)
    if (window.bossTimerInterval) clearInterval(window.bossTimerInterval);

    const updateTimer = () => {
        // ถ้าไม่มีข้อมูลบอส หรือ ไม่มีเวลาจบ ให้หยุด
        if (!currentBossData || !currentBossData.end_time) return;

        // แปลงเวลาจาก Firestore Timestamp เป็น Date Object
        // (Firestore เก็บเวลาเป็น Timestamp ต้องแปลงด้วย .toDate() ก่อน)
        const endTime = currentBossData.end_time.toDate ? currentBossData.end_time.toDate() : new Date(currentBossData.end_time);
        const now = new Date();
        const diff = endTime - now; // ผลต่างเวลา (Milliseconds)

        // กรณีหมดเวลา (Time's up)
        if (diff <= 0) {
            clearInterval(window.bossTimerInterval);
            
            // เซ็ตเลขเป็น 00:00:00
            updateTimerUI("00:00:00");
            
            // 🔥 เพิ่มเติม: ถ้าบอสยัง Active อยู่แต่เวลาหมด = แพ้ (DEFEAT)
            // (คุณอาจจะเพิ่ม logic เรียก checkBossResult('lose') ตรงนี้ถ้าต้องการให้จบอัตโนมัติ)
            return;
        }

        // คำนวณ ชม:นาที:วินาที
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        // จัด Format ให้มีเลข 0 นำหน้า (เช่น 01:05:09)
        const timeString = 
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // อัปเดตตัวเลขบนหน้าจอ
        updateTimerUI(timeString);
    };

    // Helper: ฟังก์ชันอัปเดต Text ใน Element ต่างๆ
    const updateTimerUI = (text) => {
        // 1. หน้า Admin (Command Center)
        const adminTimer = document.getElementById('admin-boss-timer');
        if (adminTimer) adminTimer.textContent = text;
        
        // 2. หน้านักเรียน (Widget) - เผื่อไว้
        const studentTimer = document.getElementById('boss-timer-display');
        if (studentTimer) studentTimer.textContent = text;
        
        // 3. หน้า Modal เดิม (เผื่อยังใช้อยู่)
        const modalTimer = document.getElementById('boss-timer');
        if (modalTimer) modalTimer.textContent = text;
    };

    // รันครั้งแรกทันทีไม่ต้องรอ 1 วินาที
    updateTimer();
    
    // ตั้ง Loop รันทุกๆ 1 วินาที
    window.bossTimerInterval = setInterval(updateTimer, 1000);
};

// ==========================================
// 🛠️ ADMIN FUNCTIONS
// ==========================================

window.openBossManagerModal = () => {
    loadBossDropOptions();
    document.getElementById('boss-manager-modal').classList.remove('hidden');
};

// 1. สร้างบอส
window.createBoss = async () => {
    const name = document.getElementById('boss-name').value;
    const hp = parseInt(document.getElementById('boss-hp').value);
    const durationVal = parseInt(document.getElementById('boss-duration-val').value) || 1;
    const unit = document.getElementById('boss-duration-unit').value;
    const reward = parseInt(document.getElementById('boss-reward').value);
    const penalty = parseInt(document.getElementById('boss-penalty').value);
    const img = document.getElementById('boss-img').value;
    const ratio = parseInt(document.getElementById('boss-ratio').value) || 1; // รับค่า Ratio

    let multiplier = 1000 * 60; // Default: นาที (ms * 60)

    if (unit === 'hour') {
        multiplier = 1000 * 60 * 60; // ชั่วโมง
    } else if (unit === 'day') {
        multiplier = 1000 * 60 * 60 * 24; // วัน
    }

    const totalDurationMs = durationVal * multiplier;
    const endTime = new Date(Date.now() + totalDurationMs);

    if (!name || !hp || !durationVal) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอกชื่อ, HP และเวลา', 'warning');

    // 🔥 รับค่าไอเทมดรอป
    const dropItemSelect = document.getElementById('boss-drop-item');
    let dropItemData = null;
    
    if (dropItemSelect && dropItemSelect.value) {
        try {
            dropItemData = JSON.parse(dropItemSelect.value);
        } catch (e) { console.error(e); }
    }

    try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'system_goals', 'current_boss'), {
            name,
            max_hp: hp,
            current_hp: hp,
            end_time: endTime,
            reward,
            penalty,
            image: img,
            damage_ratio: ratio, // 🔥 บันทึก Ratio ลง DB
            end_time: endTime,
            drop_item: dropItemData, // 💾 บันทึกข้อมูลไอเทมลง DB
            active: true,
            created_at: serverTimestamp()
        });
        Swal.fire('Summoned!', 'บอสปรากฏตัวแล้ว!', 'success');
    } catch (e) {
        console.error(e);
        Swal.fire('Error', e.message, 'error');
    }
};

// ฟังก์ชันโจมตีบอส (ปรับปรุงใหม่)
window.adjustBossHP = async (pointsUsed) => {
    if (!currentBossData) return;
    
    const bossRef = doc(db, 'artifacts', appId, 'public', 'data', 'system_goals', 'current_boss');
    const ratio = currentBossData.damage_ratio || 1; // ดึงค่า Ratio (Default 1)

    // คำนวณ Damage จริง
    // ถ้า pointsUsed เป็นลบ (โจมตี) -> หารด้วย ratio
    // ถ้า pointsUsed เป็นบวก (ฮีล) -> ไม่ต้องหาร (หรือหารก็ได้แล้วแต่กติกา)
    
    let damage = 0;
    if (pointsUsed < 0) {
        // โจมตี: เอาแต้มที่ใช้ หารด้วย Ratio
        damage = Math.floor(pointsUsed / ratio); 
    } else {
        // ฮีล: ฮีลตามจำนวนหน่วยตรงๆ (หรือจะใช้สูตรอื่นก็ได้)
        damage = pointsUsed; 
    }

    // กันเหนียว: ถ้า Damage เป็น 0 (เช่นใช้น้อยกว่า Ratio) ให้ปัดเป็น -1 (ตบเบาๆ ก็เจ็บนิดนึง)
    if (pointsUsed < 0 && damage === 0) damage = -1;

    const newHp = currentBossData.current_hp + damage;
    
    // ... (Logic ตรวจสอบ Win/Lose เหมือนเดิม) ...
    if (newHp <= 0) {
        await checkBossResult('win');
    } else {
        await updateDoc(bossRef, { current_hp: newHp });
        
        // แจ้งเตือนแบบละเอียด
        const msg = damage < 0 
            ? `💥 ใช้ ${Math.abs(pointsUsed)} แต้ม -> ทำดาเมจ ${Math.abs(damage)} (Ratio 1:${ratio})` 
            : `💊 ฮีลบอส +${damage}`;
        showToast(msg);
    }
};

// 3. จบเกม (Win/Lose) และแจกรางวัล
async function checkBossResult(result) {
    if (!currentBossData || !currentBossData.active) return;
    
    // ล็อกเพื่อไม่ให้รันซ้ำ
    const bossRef = doc(db, 'artifacts', appId, 'public', 'data', 'system_goals', 'current_boss');
    await updateDoc(bossRef, { active: false }); // ปิดบอสทันที

    const isWin = result === 'win';
    const pointsEffect = isWin ? currentBossData.reward : -currentBossData.penalty;
    
    Swal.fire({
        title: isWin ? '🎉 VICTORY!' : '☠️ DEFEAT...',
        text: isWin ? `บอสถูกกำจัด! ทุกคนได้รับ +${pointsEffect} แต้ม` : `หมดเวลา! บอสหนีไปได้ ทุกคนโดนหัก ${Math.abs(pointsEffect)} แต้ม`,
        imageUrl: currentBossData.image || '',
        imageWidth: 200,
        confirmButtonText: 'ดำเนินการแจกจ่ายผลรางวัล',
        allowOutsideClick: false
    }).then(async () => {
        // 🔄 Batch Update นักเรียนทุกคน (ระวัง Limit 500 คน)
        await distributeMassPoints(pointsEffect, isWin ? 'Boss Reward' : 'Boss Penalty');
    });
}

window.deleteBoss = async () => {
    try {
        const bossRef = doc(db, 'artifacts', appId, 'public', 'data', 'system_goals', 'current_boss');
        await deleteDoc(bossRef);
        
        // 🔥 เปลี่ยนจุดที่พัง ให้มีการใช้เครื่องหมาย ? (Optional Chaining) หรือ if เช็คก่อน
        const modal = document.getElementById('boss-manager-modal');
        if (modal) {
            modal.classList.add('hidden');
        }

        console.log("Boss deleted successfully");
    } catch (e) {
        console.error("Error deleting boss: ", e);
    }
}

// Helper เช็ค Admin (แบบง่ายๆ)
function isAdminUser() {
    // เช็คจาก LocalStorage หรือ Auth state ของคุณ
    // สมมติว่าหน้าจอ Admin คือหน้าที่ login email ครู
    return true; // (สำหรับเวอร์ชั่นนี้ให้ถือว่าเป็น Admin ไปก่อน ถ้าเป็นหน้าเด็กต้องแก้เป็น false)
}

// ==========================================
// 🔥 AUTO BOSS DAMAGE (ฉบับใหม่: รองรับรายชื่อคนตี)
// ==========================================
window.autoDamageBoss = async (contributorsMap) => {
    // เช็คว่ามีบอสอยู่ไหม
    if (!currentBossData || !currentBossData.active) return;

    // 🛡️ กันเหนียว: ถ้าส่งมาเป็นตัวเลขโดดๆ (จากโค้ดเก่า) ให้แปลงเป็น Object
    if (typeof contributorsMap === 'number') {
        return console.warn("AutoDamageBoss: ได้รับค่าเป็นตัวเลข (กรุณาแก้จุดเรียกใช้ให้ส่งเป็น Object)");
    }

    const bossRef = doc(db, 'artifacts', appId, 'public', 'data', 'system_goals', 'current_boss');
    const ratio = currentBossData.damage_ratio || 1;
    
    let totalDamage = 0;
    let updates = {};

    // วนลูปคำนวณดาเมจจากแต่ละคน
    for (const [studentId, points] of Object.entries(contributorsMap)) {
        if (points <= 0) continue;
        
        // คำนวณดาเมจจริง (หาร Ratio)
        const damage = Math.floor(points / ratio);
        if (damage < 1) continue;

        totalDamage += damage;

        // บันทึกสถิติคนตี (ใช้ dot notation เพื่อ update ใน Map)
        updates[`contributors.${studentId}`] = increment(damage);
    }

    if (totalDamage === 0) return;

    // ลดเลือดบอส
    updates.current_hp = increment(-totalDamage);

    try {
        await updateDoc(bossRef, updates);
        console.log(`⚔️ Boss taken ${totalDamage} dmg from ${Object.keys(contributorsMap).length} students`);
    } catch (e) {
        console.error("Auto boss attack error:", e);
    }
};

// ==========================================
// 🎮 Manual Boss Control (เวอร์ชัน Checkbox)
// ==========================================
window.manualAdjustBoss = async (mode) => {
    const amountStr = document.getElementById('manual-boss-dmg').value;
    const amount = parseInt(amountStr);
    
    if (!amount || amount <= 0) return Swal.fire('แจ้งเตือน', 'กรุณาระบุจำนวนที่ถูกต้อง', 'warning');

    const bossRef = doc(db, 'artifacts', appId, 'public', 'data', 'system_goals', 'current_boss');

    try {
        let updates = {};

        if (mode === 'damage') {
            updates.current_hp = increment(-amount);

            // 🔥 เปลี่ยนตรงนี้: ดึงจาก Checkbox ที่ติ๊กถูก
            const checkboxes = document.querySelectorAll('.manual-attacker-checkbox:checked');
            const selectedCount = checkboxes.length;
            
            if (selectedCount > 0) {
                // หารดาเมจเฉลี่ย
                const damagePerPerson = Math.floor(amount / selectedCount);
                
                if (damagePerPerson > 0) {
                    checkboxes.forEach(cb => {
                        const studentId = cb.value;
                        updates[`contributors.${studentId}`] = increment(damagePerPerson);
                    });
                }
                console.log(`Manual: ${amount} dmg / ${selectedCount} students`);
            } else {
                console.log(`Manual: System Damage`);
            }

        } else if (mode === 'heal') {
            updates.current_hp = increment(amount);
        }

        await updateDoc(bossRef, updates);
        
        // Reset Form
        document.getElementById('manual-boss-dmg').value = '';
        // ไม่ต้องล้าง Checkbox ก็ได้ เผื่อครูอยากย้ำอีกรอบ (หรือถ้าอยากล้างให้เรียก toggleSelectAllManual(false))
        // toggleSelectAllManual(false); 
        
        Swal.fire({
            icon: 'success',
            title: mode === 'damage' ? 'โจมตีสำเร็จ!' : 'ฟื้นฟูบอสสำเร็จ',
            text: `ดำเนินการเรียบร้อย`,
            timer: 1000,
            showConfirmButton: false
        });

    } catch (e) {
        console.error(e);
        Swal.fire('Error', e.message, 'error');
    }
};

// 📦 ฟังก์ชันดึงรายชื่อสินค้าจาก Database มาใส่ Dropdown
window.loadBossDropOptions = async () => {
    const select = document.getElementById('boss-drop-item');
    if (!select) return;

    // เคลียร์ค่าเก่าก่อน แล้วใส่ Option เริ่มต้น
    select.innerHTML = '<option value="">⏳ กำลังโหลดรายการสินค้า...</option>';

    try {
        // 1. อ้างอิงไปที่ Collection สินค้า (ปกติชื่อ 'rewards' หรือ 'shop_items')
        // ⚠️⚠️ เช็คชื่อ Collection ของคุณตรงนี้ครับ (rewards หรือ shop_items) ⚠️⚠️
        const rewardsRef = collection(db, 'artifacts', appId, 'public', 'data', 'rewards'); 
        
        // 2. ดึงข้อมูล (เอาเฉพาะที่ยังไม่ลบ หรือ Active อยู่)
        // ถ้าไม่มี field 'active' ให้ลบ where ออกได้ครับ
        const q = query(rewardsRef, orderBy('name')); 
        const querySnapshot = await getDocs(q);

        let html = '<option value="">-- ไม่แจกไอเทม (แจกแค่แต้ม) --</option>';

        if (querySnapshot.empty) {
            html += '<option value="" disabled>❌ ไม่พบสินค้าในร้านค้า</option>';
        } else {
            querySnapshot.forEach((doc) => {
                const item = doc.data();
                
                // เตรียมข้อมูลที่จะบันทึกลงตัวบอส (เก็บเป็น JSON String)
                const itemData = JSON.stringify({
                    id: doc.id,
                    name: item.name || 'ไม่ระบุชื่อ',
                    image: item.image || '', // รูปสินค้า
                    type: item.type || 'item' // ประเภท (ถ้ามี)
                });

                // สร้างตัวเลือกใน Dropdown
                html += `<option value='${itemData}'>🎁 ${item.name} (ราคา: ${item.point_cost || 0})</option>`;
            });
        }

        select.innerHTML = html;

    } catch (e) {
        console.error("Error loading shop items:", e);
        select.innerHTML = '<option value="">❌ โหลดข้อมูลล้มเหลว</option>';
    }
};

// ==========================================
// 🎁 แจกรางวัลบอส (เวอร์ชัน Ultimate Fix: แก้ไอเทมหาย + โคลนเรทกาชา 100%)
// ==========================================
window.distributeMassPoints = async (amount, reason) => {
    const safeAmount = parseInt(amount) || 0; 
    
    try {
        const bossRef = doc(db, 'artifacts', appId, 'public', 'data', 'system_goals', 'current_boss');
        const bossSnap = await getDoc(bossRef);
        
        if(!bossSnap.exists()) throw new Error("ไม่พบข้อมูลบอส");
        
        const bossData = bossSnap.data();
        const contributors = bossData.contributors || {}; 
        const participantIds = Object.keys(contributors);

        if (participantIds.length === 0) {
            await deleteDoc(bossRef);
            return Swal.fire('บอสถูกกำจัด!', 'แต่ไม่มีใครได้รับรางวัล เพราะไม่มีประวัติการทำความเสียหาย', 'info');
        }

        // 🛡️ ดึงข้อมูลไอเทมและ "โคลน (Copy)" ทุกคุณสมบัติ
        let dropItem = bossData.drop_item || null;
        let itemTemplate = null;
        let itemDataToGive = null;

        if (dropItem) {
            // 1. ค้นหาไอเทมต้นฉบับจากในร้านค้า (window.rewards)
            const targetId = typeof dropItem === 'string' ? dropItem : (dropItem.id || dropItem.item_id);
            if (targetId) {
                itemTemplate = (window.rewards || []).find(r => r.id === targetId);
            }

            // ถ้าหาในร้านไม่เจอ ให้ใช้ข้อมูลดิบจากบอส
            if (!itemTemplate && typeof dropItem === 'object') {
                itemTemplate = dropItem;
            }

            if (itemTemplate) {
                // 🔥 ท่าไม้ตาย: Deep Copy โคลนข้อมูลทุกอย่าง (min_points, max_points, ของสุ่ม ฯลฯ)
                itemDataToGive = JSON.parse(JSON.stringify(itemTemplate)); 
                
                // จัดระเบียบฟิลด์ให้ตรงกับระบบกระเป๋า
                itemDataToGive.reward_id = itemTemplate.id || 'unknown'; 
                itemDataToGive.obtained_from = 'boss_drop';
                itemDataToGive.obtained_at = new Date().toISOString();
                
                // ถ้าระบุว่าเป็นกาชา ก็ให้คงความเป็นกาชาไว้ (ไม่แปลงเป็น general_item)
                const isGacha = itemTemplate.type === 'gacha_custom' || itemTemplate.type === 'random_box' || itemTemplate.type === 'gacha_box';
                itemDataToGive.type = isGacha ? itemTemplate.type : (itemTemplate.type || 'general_item');
            }
        }
        
        const DAMAGE_BONUS_RATE = 0.1; 
        const CHUNK_SIZE = 400;
        
        for (let i = 0; i < participantIds.length; i += CHUNK_SIZE) {
            const chunkIds = participantIds.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);
            
            chunkIds.forEach(sid => {
                const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', sid);
                const myDamage = parseInt(contributors[sid]) || 0;
                
                let bonusPoints = 0;
                if (safeAmount > 0) {
                    bonusPoints = Math.floor(myDamage * DAMAGE_BONUS_RATE);
                }

                const totalPointsReceived = safeAmount + bonusPoints;

                // A. อัปเดตแต้ม
                batch.update(sRef, { points: increment(totalPointsReceived) });
                
                // B. แจกไอเทมดรอป
                if (typeof itemDataToGive !== 'undefined' && itemDataToGive && safeAmount >= 0) {
                    // 🔥 สร้าง ID เฉพาะตัวให้ไอเทมแต่ละชิ้น (ป้องกันบั๊ก "ไอเทมหายไปแล้ว")
                    const uniqueInstanceId = crypto.randomUUID();
                    
                    const newItemForStudent = {
                        ...itemDataToGive,
                        id: uniqueInstanceId,           // ให้ useItem มองเห็น
                        instance_id: uniqueInstanceId   // ให้ useItem มองเห็น (เผื่อไว้ 2 ทาง)
                    };
                    
                    batch.update(sRef, { inventory: arrayUnion(newItemForStudent) });
                }
            });
            await batch.commit();
        }

        await deleteDoc(bossRef);
        
        let msg = `แจกรางวัลผู้กล้า ${participantIds.length} คนสำเร็จ!`;
        if (typeof itemDataToGive !== 'undefined' && itemDataToGive && safeAmount >= 0) {
            msg += `\n🎁 ได้รับ [${itemDataToGive.name || 'ไอเทมลึกลับ'}] เข้ากระเป๋าแล้ว!`;
        }
        
        Swal.fire('Victory!', msg, 'success');
        
        if(document.getElementById('boss-manager-modal')) {
            document.getElementById('boss-manager-modal').classList.add('hidden');
        }

    } catch (e) {
        console.error("Error distributing mass points:", e);
        Swal.fire('Error', 'เกิดข้อผิดพลาดในการแจกของ: ' + e.message, 'error');
    }
};

// ==========================================
// 🎁 ฟังก์ชันกดแจกรางวัลด้วยมือ (Manual Trigger)
// ==========================================
window.triggerManualReward = () => {
    if (!currentBossData) return Swal.fire('Error', 'ไม่พบข้อมูลบอส', 'error');
    
    // ดึงค่ารางวัลที่ตั้งไว้
    const winReward = parseInt(currentBossData.win_reward || currentBossData.reward || 500);
    
    // ถามย้ำเพื่อความชัวร์ (กันเผลอไปโดน)
    Swal.fire({
        title: 'ยืนยันการแจกรางวัล?',
        text: `นักเรียนที่ร่วมโจมตีจะได้รับ ${winReward} แต้ม + โบนัสดาเมจ + ไอเทมดรอป`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#d33',
        confirmButtonText: 'ยืนยัน แจกเลย!',
        cancelButtonText: 'ยกเลิก'
    }).then((result) => {
        if (result.isConfirmed) {
            // เรียกฟังก์ชันแจกของ (ตัวกันบั๊กที่เราเพิ่งทำไป)
            if (typeof window.distributeMassPoints === 'function') {
                window.distributeMassPoints(winReward, 'พิชิตบอสสำเร็จ');
            } else {
                Swal.fire('Error', 'ไม่พบฟังก์ชันแจกรางวัล', 'error');
            }
        }
    });
};

// ==========================================
// 🏥 ระบบคลินิกสอบแก้ตัว (Remedial Clinic)
// ==========================================

// 1. เปิด Modal และโหลดรายชื่อ
window.openClinicModal = () => {
    const modal = document.getElementById('clinic-modal');
    const select = document.getElementById('clinic-student-select');
    const searchInput = document.getElementById('clinic-student-search');
    
    // จัดการตัวแปรรายชื่อนักเรียน (รองรับทั้ง window.studentsData และ students)
    const studentList = (typeof students !== 'undefined' ? students : window.studentsData) || [];

    if (studentList.length > 0) {
        // เก็บรายชื่อ HTML ต้นฉบับไว้สำหรับการค้นหา
        window.clinicAllStudentsHtml = studentList.map(s => 
            `<option value="${s.id}">${s.student_id} ${s.full_name} (แต้ม: ${Math.floor(s.points)})</option>`
        ).join('');
        select.innerHTML = window.clinicAllStudentsHtml;
    } else {
        window.clinicAllStudentsHtml = '<option value="" disabled>ไม่พบข้อมูลนักเรียน</option>';
        select.innerHTML = window.clinicAllStudentsHtml;
    }

    // รีเซ็ตค่า
    if (searchInput) searchInput.value = '';
    document.getElementById('clinic-chapter-input').value = '';
    document.getElementById('clinic-base-cost').value = '50';
    document.getElementById('clinic-attempt-count').innerText = '0';
    document.getElementById('clinic-final-cost').innerText = '0';

    modal.classList.remove('hidden');
};

window.closeClinicModal = () => {
    document.getElementById('clinic-modal').classList.add('hidden');
};

// 🌟 ฟังก์ชันใหม่: กรองรายชื่อนักเรียนแบบ Real-time
window.filterClinicStudents = () => {
    const searchInput = document.getElementById('clinic-student-search').value.toLowerCase();
    const select = document.getElementById('clinic-student-select');
    const studentList = (typeof students !== 'undefined' ? students : window.studentsData) || [];
    
    if (!searchInput) {
        select.innerHTML = window.clinicAllStudentsHtml;
        return;
    }

    // ค้นหาจากรหัส หรือ ชื่อ
    const filtered = studentList.filter(s => 
        (s.student_id && s.student_id.toLowerCase().includes(searchInput)) || 
        (s.full_name && s.full_name.toLowerCase().includes(searchInput))
    );

    if (filtered.length > 0) {
        select.innerHTML = filtered.map(s => 
            `<option value="${s.id}">${s.student_id} ${s.full_name} (แต้ม: ${Math.floor(s.points)})</option>`
        ).join('');
    } else {
        select.innerHTML = '<option value="" disabled>-- ไม่พบรายชื่อที่ค้นหา --</option>';
    }
};

// 2. คำนวณราคาสดๆ (x2 ตามจำนวนครั้ง)
window.calculateClinicCost = () => {
    const studentId = document.getElementById('clinic-student-select').value;
    const chapter = document.getElementById('clinic-chapter-input').value.trim();
    const baseCost = parseInt(document.getElementById('clinic-base-cost').value) || 0;

    let attemptCount = 0;
    const studentList = (typeof students !== 'undefined' ? students : window.studentsData) || [];

    if (studentId && chapter && studentList.length > 0) {
        const student = studentList.find(s => s.id === studentId);
        if (student && student.exam_retakes && student.exam_retakes[chapter]) {
            attemptCount = student.exam_retakes[chapter];
        }
    }

    const finalCost = baseCost * Math.pow(2, attemptCount);

    document.getElementById('clinic-attempt-count').innerText = attemptCount;
    document.getElementById('clinic-final-cost').innerText = finalCost.toLocaleString();
};

// 3. ยืนยันการหักแต้มและบันทึกข้อมูล
window.confirmClinicPurchase = async () => {
    const studentId = document.getElementById('clinic-student-select').value;
    const chapter = document.getElementById('clinic-chapter-input').value.trim();
    const baseCost = parseInt(document.getElementById('clinic-base-cost').value) || 0;

    if (!studentId) return alert('กรุณาเลือกนักเรียน');
    if (!chapter) return alert('กรุณาระบุบทเรียนที่ต้องการแก้ตัว');

    const studentList = (typeof students !== 'undefined' ? students : window.studentsData) || [];
    const student = studentList.find(s => s.id === studentId);
    
    if (!student) return alert('ไม่พบข้อมูลนักเรียน');

    let attemptCount = (student.exam_retakes && student.exam_retakes[chapter]) ? student.exam_retakes[chapter] : 0;
    const finalCost = baseCost * Math.pow(2, attemptCount);

    if (student.points < finalCost) {
        return Swal.fire('แต้มไม่พอ!', `นักเรียนมีแต้ม ${Math.floor(student.points)} แต่ต้องใช้ ${finalCost} แต้ม`, 'error');
    }

    // ถามยืนยัน
    Swal.fire({
        title: 'ยืนยันการซื้อสิทธิ์?',
        text: `หัก ${finalCost} แต้ม เพื่อสอบแก้ตัวบท "${chapter}" (ครั้งที่ ${attemptCount + 1})`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ec4899', // pink-500
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'ยืนยัน!',
        cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const batch = writeBatch(db);
                const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', studentId);
                const hRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'history'));

                const currentRetakes = student.exam_retakes || {};
                currentRetakes[chapter] = attemptCount + 1;

                batch.update(sRef, { 
                    points: increment(-finalCost),
                    exam_retakes: currentRetakes 
                });

                batch.set(hRef, {
                    student_id: student.student_id,
                    student_name: student.full_name,
                    action: `คลินิกแก้ตัว: บท "${chapter}" (แก้ครั้งที่ ${attemptCount + 1})`,
                    amount: -finalCost,
                    type: 'clinic_retake',
                    timestamp: serverTimestamp()
                });

                await batch.commit();
                
                closeClinicModal();
                Swal.fire('สำเร็จ!', `จ่ายค่าปรับ ${finalCost} แต้ม และเปิดสิทธิ์สอบให้แล้ว!`, 'success');

            } catch (error) {
                console.error("Clinic Error:", error);
                Swal.fire('Error', 'เกิดข้อผิดพลาด: ' + error.message, 'error');
            }
        }
    });
};

// ==========================================
// 🎮 PAGINATION CONTROLLER (ตัวควบคุมการเปลี่ยนหน้า)
// ==========================================

// 1. ตั้งค่าตัวแปร Global (ถ้ายังไม่มี)
window.itemsPerPage = window.itemsPerPage || 10; // ค่าเริ่มต้น 10 แถว
window.paginationState = window.paginationState || { 
    history: 1, 
    students: 1, 
    guilds: 1,
    rewards: 1
};

// 2. ฟังก์ชันเปลี่ยนหน้า (Next/Prev)
window.changePage = (type, direction) => {
    // อัปเดตเลขหน้า
    if (!window.paginationState[type]) window.paginationState[type] = 1;
    window.paginationState[type] += direction;

    // ป้องกันเลขหน้าติดลบ (ส่วนเลขหน้าเกินจำนวนสูงสุด จะถูกดักในฟังก์ชัน render ของแต่ละหน้าเอง)
    if (window.paginationState[type] < 1) window.paginationState[type] = 1;

    // 🔥 สั่งรีเฟรชหน้าจอ (Routing)
    refreshViewByType(type);
};

// 3. ฟังก์ชันเปลี่ยนจำนวนแถวต่อหน้า (10, 20, 50)
window.changeItemsPerPage = (type, value) => {
    window.itemsPerPage = parseInt(value);
    window.paginationState[type] = 1; // รีเซ็ตกลับไปหน้า 1 เสมอเมื่อเปลี่ยนจำนวนแถว
    
    // 🔥 สั่งรีเฟรชหน้าจอ
    refreshViewByType(type);
};

// 4. ฟังก์ชัน Router: เลือกฟังก์ชันที่จะวาดใหม่ตามประเภท
const refreshViewByType = (type) => {
    console.log(`🔄 Refreshing view: ${type}, Page: ${window.paginationState[type]}`);
    
    switch (type) {
        case 'history':
            if (typeof renderHistory === 'function') renderHistory(false); // false = ห้ามรีเซ็ตหน้า 1
            break;
            
        case 'student': // หรือ 'students' เช็คตามที่คุณใช้จริง
        case 'students':
            if (typeof renderStudentList === 'function') renderStudentList(false);
            break;
            
        case 'guild':
        case 'guilds':
            if (typeof renderGuildsDashboard === 'function') renderGuildsDashboard(false); 
            break;

        case 'reward':
        case 'rewards':
            if (typeof renderRewards === 'function') renderRewards();
            break;
            
        default:
            console.warn('ไม่พบฟังก์ชันสำหรับ Render ประเภท:', type);
    }
};

// 5. ฟังก์ชันวาดปุ่ม (ใช้โค้ดของคุณ แต่ปรับให้ใช้ Global Variable)
window.renderPaginationControls = (totalItems, type) => {
    const currentPage = window.paginationState[type] || 1;
    // ใช้ window.itemsPerPage เพื่อให้ค่าตรงกันทั้งระบบ
    const totalPages = Math.ceil(totalItems / window.itemsPerPage) || 1;
    
    if (totalItems === 0) return '';
    
    const options = [10, 20, 50, 100];
    const optionsHtml = options.map(opt => 
        `<option value="${opt}" ${opt === window.itemsPerPage ? 'selected' : ''}>${opt} แถว</option>`
    ).join('');

    return `
        <div class="flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-600 w-full mt-4 select-none">
            <div class="flex items-center gap-2">
                <span>แสดง</span>
                <select onchange="changeItemsPerPage('${type}', this.value)" class="border rounded p-1 bg-white focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer">
                    ${optionsHtml}
                </select>
                <span>รายการ</span>
            </div>
            <div class="flex items-center gap-2">
                <button onclick="changePage('${type}', -1)" ${currentPage === 1 ? 'disabled' : ''} 
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    ก่อนหน้า
                </button>
                
                <span class="font-bold text-indigo-600 mx-2">หน้า ${currentPage} / ${totalPages}</span>
                
                <button onclick="changePage('${type}', 1)" ${currentPage >= totalPages ? 'disabled' : ''} 
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    ถัดไป
                </button>
            </div>
        </div>
    `;
};
