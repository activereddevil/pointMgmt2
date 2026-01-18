import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, getDoc, onSnapshot, query, where, getDocs, increment, serverTimestamp, writeBatch, arrayUnion, arrayRemove, deleteField, runTransaction } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";    // --- Firebase Config (Auto-injected by Canvas) ---
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
const appId = 'activeredpoint';


// --- Global State ---
let userRole = 'guest'; // 'teacher' or 'student'
let currentStudentData = null; // For student role
let students = [];
let rewards = [];
let history = [];
let quests = [];
let tempGuildSelection = new Set(); // 🧠 ตัวแปรจำรายชื่อสมาชิกที่ถูกเลือกชั่วคราว
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
    
    // Clear previous intervals if any
    if (window.interestInterval) clearInterval(window.interestInterval);
    
    // Start new interval for Real-time Interest Update (30s)
    window.interestInterval = setInterval(() => {
        if (userRole === 'teacher') renderBankList(false); // Updated to pass false to prevent page reset on interval
        if (userRole === 'student') renderStudentDashboard();
    }, 30000); 
    
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
                    streakConfig.milestones.forEach((m, i) => {
                        const dInput = document.getElementById(`conf-streak-d${i+1}`);
                        const pInput = document.getElementById(`conf-streak-p${i+1}`);
                        if(dInput) dInput.value = m.days;
                        if(pInput) pInput.value = m.bonus;
                    });
                }

                // 3. 🔥 สั่งวาดปุ่มนักเรียนใหม่ทันที (Force Re-render)
                // เช็คด้วยว่า Widget ถูกสร้างหรือยัง
                if (document.getElementById('student-streak-widget') && window.currentStudentData) {
                    renderStreakWidget(window.currentStudentData);
                    console.log("✨ รีเฟรชปุ่มรับแต้มเรียบร้อย!");
                }
            }
        } else {
            console.warn("⚠️ ไม่พบ Config ใน DB ใช้ค่า Default แทน");
        }
    }, (error) => {
        console.error("❌ เกิดข้อผิดพลาดในการโหลด Streak Config:", error);
    });
}

// 2. บันทึก Config (กดปุ่ม Save)
window.saveStreakConfig = async () => {
    const base = parseInt(document.getElementById('conf-streak-base').value) || 10;
    let milestones = [];
    for(let i=1; i<=5; i++) {
        milestones.push({
            days: parseInt(document.getElementById(`conf-streak-d${i}`).value) || 0,
            bonus: parseInt(document.getElementById(`conf-streak-p${i}`).value) || 0
        });
    }
    // เรียงลำดับวัน
    milestones.sort((a, b) => a.days - b.days);

    const newData = { base_points: base, milestones: milestones };
    try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'config_streak'), newData);
        streakConfig = newData;
        alert('บันทึกตั้งค่าเรียบร้อย ✅');
    } catch(e) { alert('Error: ' + e.message); }
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
window.claimDailyStreak = async () => {
    if (!currentStudentData) return;
    
    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', currentStudentData.id);
    
    // เช็คซ้ำอีกรอบ
    const sSnap = await getDoc(sRef);
    const sData = sSnap.data();
    const streakData = sData.streak_data || { count: 0, last_claim: null, max: 0 };
    
    if (!checkCanClaim(streakData.last_claim)) return showToast('วันนี้รับไปแล้วครับ พรุ่งนี้มาใหม่นะ', 'error');

    // คำนวณ Streak
    let newCount = streakData.count;
    const last = streakData.last_claim ? (streakData.last_claim.toDate ? streakData.last_claim.toDate() : new Date(streakData.last_claim)) : null;
    const now = new Date();

    if (last) {
        const diffHours = (now - last) / (1000 * 60 * 60);
        if (diffHours > 48) { // เกิน 48 ชม. (ไม่ได้มากดเมื่อวาน)
            newCount = 1;
        } else {
            newCount++;
        }
    } else {
        newCount = 1;
    }
    
    const newMax = Math.max(streakData.max, newCount);
    let pointsToAdd = streakConfig.base_points;
    let logMsg = `เช็คชื่อรายวัน (Day ${newCount})`;

    // เช็คโบนัส
    const milestone = streakConfig.milestones.find(m => m.days === newCount);
    if (milestone) {
        pointsToAdd += milestone.bonus;
        logMsg += ` + โบนัส ${milestone.days} วัน!`;
        // เอฟเฟกต์แสดงความยินดี (ถ้ามี)
        alert(`🎉 ยินดีด้วย! คุณเช็คชื่อครบ ${newCount} วัน ได้รับโบนัส ${milestone.bonus} แต้ม!`);
    }

    try {
        const batch = writeBatch(db);
        batch.update(sRef, {
            points: increment(pointsToAdd),
            streak_data: { count: newCount, max: newMax, last_claim: serverTimestamp() }
        });
        
        const hRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'history'));
        batch.set(hRef, {
            student_id: sData.student_id,
            student_name: sData.full_name,
            action: logMsg,
            amount: pointsToAdd,
            type: 'daily_streak',
            timestamp: serverTimestamp()
        });

        await batch.commit();
        showToast(`✅ เช็คชื่อสำเร็จ! +${pointsToAdd} แต้ม`);
        // renderStudentDashboard จะทำงานอัตโนมัติผ่าน onSnapshot
    } catch(e) { console.error(e); alert('Error: ' + e.message); }
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
            <button onclick="switchTab('groups')" id="tab-btn-groups" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700"><span>👥</span> จัดกลุ่ม</button>
            <button onclick="switchTab('quests')" id="tab-quests" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">ภารกิจ</button>
            
            <button onclick="switchTab('history')" id="tab-history" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">ประวัติ</button>
            <button onclick="switchTab('rewards')" id="tab-rewards" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">รางวัล</button>
            
            <button onclick="switchTab('report')" id="tab-report" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700">รายงานผล</button>
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
        if (userRole === 'student') {
            const me = students.find(s => s.student_id === currentStudentData.student_id);
            if (me) {
                currentStudentData = me;
                renderStudentDashboard();
            }
        } else {
            renderStudentList(false); // Don't reset page on live update
            renderGuildsDashboard();
        }
        renderBankList(false); // Don't reset page on live update
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
                    else if (h.type === 'red_card') redCardList.push(h);
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
        if (userRole === 'student') renderStudentDashboard();
    }, onError));
    
    unsubscribers.push(onSnapshot(collections.config(), (snapshot) => {
        const settingsDoc = snapshot.docs.find(d => d.id === 'school_settings');
        
        if (settingsDoc) {
            const cfg = settingsDoc.data();
            config = { ...config, ...cfg };

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
            if (userRole === 'teacher') {
                 // Check if focused to avoid overwriting while typing
                
                 // 1. อัปเดตดอกเบี้ย (มีเช็ค activeElement เพื่อไม่ให้กวนตอนพิมพ์)
const elInterest = document.getElementById('new-interest-rate');
if (elInterest && document.activeElement.id !== 'new-interest-rate') {
    elInterest.value = config.interest_rate || 1.0;
}

// 2. อัปเดตค่าปรับใบแดง (🔥 ตัวต้นเหตุ: ใส่ if ดักไว้ กัน Error)
const elDeduct = document.getElementById('points-per-red-card');
if (elDeduct && document.activeElement.id !== 'points-per-red-card') {
    elDeduct.value = config.deduct_rate || 0;
}

// 3. อัปเดตค่าล้างใบแดง (🔥 ใส่ if ดักไว้เช่นกัน)
const elClear = document.getElementById('points-to-clear-red-card');
if (elClear && document.activeElement.id !== 'points-to-clear-red-card') {
    elClear.value = config.clear_rate || 0;
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

// --- RENDER FUNCTIONS ---

// Pagination Helper
function getPaginatedData(data, page) {
    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return {
        data: data.slice(start, end),
        totalPages: Math.ceil(data.length / itemsPerPage)
    };
}

function renderPaginationControls(totalItems, type) {
    const currentPage = paginationState[type];
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    if (totalItems === 0) return '';
    
    const options = [10, 20, 50, 100];
    const optionsHtml = options.map(opt => 
        `<option value="${opt}" ${opt === itemsPerPage ? 'selected' : ''}>${opt} แถว</option>`
    ).join('');

    return `
        <div class="flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-600 w-full">
            <div class="flex items-center gap-2">
                <span>แสดง</span>
                <select onchange="changeItemsPerPage('${type}', this.value)" class="border rounded p-1 bg-white focus:ring-2 focus:ring-indigo-500 outline-none">
                    ${optionsHtml}
                </select>
                <span>รายการ</span>
            </div>
            <div class="flex items-center gap-4">
                <button onclick="changePage('${type}', -1)" ${currentPage === 1 ? 'disabled' : ''} class="px-3 py-1 bg-white border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">ก่อนหน้า</button>
                <span>หน้า ${currentPage} / ${totalPages || 1}</span>
                <button onclick="changePage('${type}', 1)" ${currentPage >= totalPages ? 'disabled' : ''} class="px-3 py-1 bg-white border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">ถัดไป</button>
            </div>
        </div>
    `;
}

window.changePage = (type, delta) => {
    paginationState[type] += delta;
    if (type === 'home') renderStudentList(false);
    if (type === 'bank') renderBankList(false);
    if (type === 'history') renderHistory(false);
    if (type === 'guilds') renderGuildsDashboard(false);
};

window.changeItemsPerPage = (type, val) => {
    itemsPerPage = parseInt(val);
    // Reset to page 1 for the current tab to avoid out of bounds
    if (type === 'home') renderStudentList(true);
    if (type === 'bank') renderBankList(true);
    if (type === 'history') renderHistory(true);
    if (type === 'guilds') renderGuildsDashboard(true);
};

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
    if (tabName === 'groups' && typeof renderCustomGroups === 'function') {
        renderCustomGroups();
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

// ✅ ฟังก์ชันแสดงรายชื่อนักเรียน (ฉบับ Super Dashboard)
// ✅ ฟังก์ชันแสดงรายชื่อนักเรียน (อัปเดต: เพิ่มแท็กเวลาบัฟ 🕒)
// ✅ ฟังก์ชันแสดงรายชื่อนักเรียน (อัปเกรด: แสดงยอดบัฟแบบทบกัน ➕)
window.renderStudentList = (resetPage = true) => {
    if (resetPage) paginationState.home = 1;
    const tbody = document.getElementById('student-list');
    const filter = document.getElementById('search-input').value.toLowerCase();
    
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
    const { data: paginatedData } = getPaginatedData(filtered, paginationState.home);
    
    // Sync Checkbox
    const selectAllCheckbox = document.getElementById('select-all');
    if(selectAllCheckbox) {
        const allOnPageSelected = paginatedData.length > 0 && paginatedData.every(s => selectedStudentIds.has(s.id));
        selectAllCheckbox.checked = allOnPageSelected;
    }

    const baseRate = (config && config.interest_rate) ? config.interest_rate : 1.0;

    tbody.innerHTML = paginatedData.map(s => {
        // --- 🏰 1. ข้อมูลกิลด์ ---
        let guildBadge = '';
        let guildBonus = 0;
        let guildDiscount = 0;
        let guildBoost = 0;

        if (s.guild_id) {
            const g = guilds.find(x => x.id === s.guild_id);
            if (g) {
                if (g.buff_interest) guildBonus = parseFloat(g.buff_interest);
                // เก็บค่าบัฟกิลด์ไว้นำไปรวม
                const activeBuffs = getGuildActiveBuffs(g.id); 
                if(activeBuffs.discount) guildDiscount = parseFloat(activeBuffs.discount);
                if(activeBuffs.point_boost) guildBoost = parseFloat(activeBuffs.point_boost);

                guildBadge = `<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200 cursor-help" title="กิลด์ ${g.name} (ดอกเบี้ย +${(guildBonus).toFixed(2)}%, ลด ${guildDiscount}%, บูสต์ +${guildBoost}%)">${g.icon}</span>`;
            }
        }

        // --- 🕒 2. คำนวณเวลาและค่าบัฟส่วนตัว ---
        let buffBadgesHtml = '';
        
        // A. ดอกเบี้ยส่วนตัว
        const interestTime = getRemainingTimeText(s.special_interest_end);
        let personalInterest = interestTime ? parseFloat(s.special_interest_rate || 0) : 0;
        if (interestTime) {
            buffBadgesHtml += `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap" title="บัฟส่วนตัว: ดอกเบี้ย +${personalInterest}% เหลือ ${interestTime}">📈 ${interestTime}</span>`;
        }

        // B. ส่วนลดส่วนตัว (Discount)
        const discountTime = getRemainingTimeText(s.buff_discount_end);
        let personalDiscount = discountTime ? parseFloat(s.buff_discount_val || 0) : 0;
        if (discountTime) {
            buffBadgesHtml += `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700 border border-red-200 whitespace-nowrap" title="บัฟส่วนตัว: ลดราคา ${personalDiscount}% เหลือ ${discountTime}">🏷️ ${discountTime}</span>`;
        }

        // C. บูสต์แต้มส่วนตัว (Point Boost)
        const boostTime = getRemainingTimeText(s.buff_points_end);
        let personalBoost = boostTime ? parseFloat(s.buff_points_val || 0) : 0;
        if (boostTime) {
            buffBadgesHtml += `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap" title="บัฟส่วนตัว: บูสต์แต้ม +${personalBoost}% เหลือ ${boostTime}">🚀 ${boostTime}</span>`;
        }

        // --- 🏦 3. คำนวณดอกเบี้ยรวม (ทบกัน: Base + Guild + Personal) ---
        // 🔥 ตรงนี้คือหัวใจสำคัญ: บวกทบกันให้หมด
        let finalRate = baseRate + guildBonus + personalInterest;
        
        let rateTag = '';
        if (finalRate > baseRate) {
            let icon = '🔥';
            let colorClass = 'bg-green-50 text-green-700 border-green-200';
            
            // ถ้ามีบัฟส่วนตัว ให้สีม่วง (Premium)
            if (personalInterest > 0) { 
                icon = '🌟'; 
                colorClass = 'bg-purple-50 text-purple-700 border-purple-200'; 
            } 
            else if (guildBonus > 0) { 
                icon = '🛡️'; 
            } 

            // Tooltip แจกแจงที่มาของตัวเลข
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

        // คำนวณเงิน
        const pendingInterest = calculatePendingInterest(s);
        const totalWithdrawable = (s.bank_points || 0) + pendingInterest;
        const isSelected = selectedStudentIds.has(s.id);
        const rowClass = isSelected ? 'bg-green-50 border-l-4 border-l-green-500' : 'hover:bg-gray-50 border-l-4 border-l-transparent';

        return `
        <tr onclick="toggleSelectStudent('${s.id}')" class="cursor-pointer transition-all border-b last:border-b-0 group ${rowClass}">
            <td class="px-2 py-3 text-center">
                <div class="w-5 h-5 rounded border flex items-center justify-center mx-auto ${isSelected ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 bg-white'}">
                    ${isSelected ? '✓' : ''}
                </div>
            </td>
            
            <td class="px-2 py-3 text-xs text-gray-500 font-mono">${s.student_id}</td>
            
            <td class="px-2 py-3">
                <div class="flex flex-col items-start gap-1">
                    <span class="font-bold text-gray-800 text-sm flex items-center flex-wrap gap-1 leading-snug">
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
                ${(s.bank_points || 0).toLocaleString()}
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
                    ${(s.pending_points || 0) > 0 ? `<div class="text-[10px] text-red-500 font-bold mt-1 bg-red-50 px-1 rounded border border-red-100">🔒 อายัด ${s.pending_points}</div>` : ''}
                </div>
            </td>

            <td class="px-2 py-3 text-center" onclick="event.stopPropagation()">
                <div class="flex items-center justify-center gap-1">
                    <button onclick="openBankModal('${s.id}')" class="p-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg border border-green-200 transition-colors" title="ธุรกรรมธนาคาร">
                        🏦
                    </button>
                    <button onclick="openEditStudentModal('${s.id}')" class="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="แก้ไข">
                        ✏️
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
    
    document.getElementById('pagination-home').innerHTML = renderPaginationControls(filtered.length, 'home');
    renderPunishmentList();
    updateBulkUI();
};



function renderStudentDashboard() {
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
                ${isPositive ? '+' : '-'}${h.amount}
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
        let displayRewards = [...rewards];

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
        grid.innerHTML = rewards.map(r => {
            // --- 🟢 ส่วนที่แก้: Logic แสดงผลฝั่งนักเรียน ---
            const isGain = r.points < 0; // ถ้าแต้มติดลบ แปลว่า "แจกแต้ม"
            
            const canAfford = isGain ? true : (currentStudentData ? currentStudentData.points >= r.points : false);
            const isUnlimited = r.stock === -1;
            const hasStock = isUnlimited || r.stock > 0;
            
            // ถ้าเป็นงาน (แจกแต้ม) ไม่ต้องเช็ค canAfford (แต้มพอไหม) เช็คแค่ของหมดไหม
            const disabled = isGain ? !hasStock : (!canAfford || !hasStock);
            
            let stockLabel = isUnlimited ? 'ไม่จำกัด' : `${r.stock} ชิ้น`;
            
            // ปรับ UI ตามประเภท (งาน vs รางวัล)
            const pointsLabel = isGain ? `+${Math.abs(r.points)} แต้ม` : `🪙 ${r.points} แต้ม`;
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

// Exposed to window for inline HTML calls
// ✅ ฟังก์ชันแสดงประวัติ (ฉบับอัปเกรด: แยกสีแดง/เขียว ตามประเภทธุรกรรม)
window.renderHistory = (resetPage = true) => {
    if (resetPage) paginationState.history = 1;
    const tbody = document.getElementById('history-list');
    const filter = document.getElementById('history-search-input').value.toLowerCase();

    // กรองข้อมูล
    let filtered = history.filter(h => 
        h.student_name.toLowerCase().includes(filter) || 
        h.action.toLowerCase().includes(filter) ||
        (h.reason && h.reason.toLowerCase().includes(filter))
    );

    // เรียงลำดับ (ใหม่สุดขึ้นก่อน)
    filtered.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

    // Pagination
    const { data: paginatedData } = getPaginatedData(filtered, paginationState.history);
    
    tbody.innerHTML = paginatedData.map(h => {
        let dateStr = formatFirestoreTimestamp(h.timestamp);

        // 🔥 LOGIC การแสดงผล +/-
        // รายการที่ถือว่าเป็นรายจ่าย (ต้องติดลบ)
        const expenseTypes = [
            'buy_item',         // ซื้อของ
            'bank_deposit',     // ฝากเงิน (เงินออกจากกระเป๋า)
            'deposit',
            'punishment',       // บทลงโทษ
            'deduct_points',    // หักแต้ม
            'remove_points',
            'create_guild',     // สร้างกิลด์
            'gacha',            // สุ่มกาชา
            'clear_red_card',   // ล้างใบแดง
            'redeem'            // แลกของรางวัล
        ];

        // เช็คว่าเป็นรายจ่าย หรือ ค่าในฐานข้อมูลติดลบอยู่แล้ว
        const isNegative = expenseTypes.includes(h.type) || h.amount < 0 || h.action.includes('ถอน'); // ดักคำว่าถอนเผื่อไว้
        
        // ถ้าเป็น 'bank_withdraw' (ถอนเงิน) ต้องเป็นบวก (เงินเข้ากระเป๋า)
        const isPositive = !isNegative || h.type === 'bank_withdraw' || h.type === 'withdraw';

        // จัดรูปแบบตัวเลข
        const amountVal = Math.abs(h.amount).toLocaleString();
        
        // กำหนดสีและเครื่องหมาย
        const amountHtml = !isPositive 
            ? `<span class="text-red-600 font-bold">-${amountVal}</span>` 
            : `<span class="text-green-600 font-bold">+${amountVal}</span>`;

        return `
        <tr class="hover:bg-gray-50 border-b last:border-b-0 text-sm group">
            <td class="px-4 py-3 text-gray-500 whitespace-nowrap">${dateStr}</td>
            <td class="px-4 py-3 font-bold text-gray-700">${h.student_name}</td>
            <td class="px-4 py-3">
                <div class="flex flex-col">
                    <span class="font-bold text-gray-800">${h.action}</span>
                    ${h.reason ? `<span class="text-xs text-gray-400">${h.reason}</span>` : ''}
                </div>
            </td>
            <td class="px-4 py-3 text-right text-base">${amountHtml}</td>
            <td class="px-4 py-3 text-center">
                <button onclick="deleteHistoryItem('${h.id}')" class="text-gray-300 hover:text-red-500 p-1 transition-colors" title="ลบรายการ">🗑️</button>
            </td>
        </tr>
        `;
    }).join('');

    document.getElementById('pagination-history').innerHTML = renderPaginationControls(filtered.length, 'history');
};

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
        red_cards: 0,
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
        
        const [stdId, name, className, points, redCards] = parts;
        
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
            red_cards: parseInt(redCards) || 0,
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
    const { type, isBulk, isRedCard, id } = currentPointAction;
    
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

    targetIds.forEach(studentId => {
        const s = students.find(std => std.id === studentId);
        if (!s) return; // Should not happen if sync is correct

        // Explicit Paths
        const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
        const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
        
        if (isRedCard) {
            const change = type === 'add' ? amount : -amount;
            batch.update(sRef, { red_cards: increment(change) });
            batch.set(hRef, {
                student_id: s.id,
                student_name: s.full_name,
                action: type === 'add' ? 'ได้รับใบแดง' : 'ลบใบแดง',
                amount: amount,
                reason: reason,
                type: 'red_card',
                timestamp: timestamp
            });
        } else {
            let finalAmount = amount;
            let logAction = type === 'add' ? 'ได้รับแต้ม' : 'ถูกหักแต้ม';

            if (type === 'add') {
                finalAmount = calculateBuffedPoints(s, amount);
                if (finalAmount > amount) logAction += ` (Boost ${finalAmount - amount})`;
                
                // 🔒 เช็คใบเตือน: ถ้ามีใบเตือน -> เข้า pending_points
                if ((s.warning_cards || 0) > 0) {
                    batch.update(sRef, { pending_points: increment(finalAmount) });
                    logAction += ` (ติดสถานะใบเตือน: อายัด)`;
                } else {
                    batch.update(sRef, { points: increment(finalAmount) });
                }
                
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
        }
    });
     
     
    await batch.commit();
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

// Header "Select All" Handler (Toggles current page)
window.toggleSelectAll = () => {
    const allCheckbox = document.getElementById('select-all');
    const isChecked = allCheckbox.checked;
    
    // Get currently visible students (based on pagination/search)
    const filter = document.getElementById('search-input').value.toLowerCase();
    let filtered = students.filter(s => 
        s.full_name.toLowerCase().includes(filter) || 
        s.student_id.includes(filter) ||
        s.class_name.toLowerCase().includes(filter)
    );
    if (sortState.student.col) {
        filtered = sortList(filtered, sortState.student.col, sortState.student.asc);
    }
    const { data: visibleStudents } = getPaginatedData(filtered, paginationState.home);

    visibleStudents.forEach(s => {
        if (isChecked) {
            selectedStudentIds.add(s.id);
        } else {
            selectedStudentIds.delete(s.id);
        }
    });

    // Re-render to update checkbox states visually
    renderStudentList(false); 
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

    let quota = 0;
    if (type !== 'gacha_custom') {
        const isQuotaUnlimited = document.getElementById('edit-reward-quota-unlimited').checked;
        quota = isQuotaUnlimited ? 0 : (parseInt(document.getElementById('edit-reward-quota').value) || 0);
    }

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

function renderShopGrid() {
    const grid = document.getElementById('shop-grid');
    
    if (typeof selectedStudentForRedeem === 'undefined' || !selectedStudentForRedeem) {
        grid.innerHTML = '<p class="text-center text-gray-500 w-full col-span-3">ไม่พบข้อมูลนักเรียน</p>';
        return;
    }

    // ดึงข้อมูลสดใหม่
    const s = students.find(x => x.id === selectedStudentForRedeem.id);
    if (!s) { 
         grid.innerHTML = '<p class="text-center text-gray-500 w-full col-span-3">ข้อมูลนักเรียนไม่อัปเดต โปรดลองใหม่</p>';
         return;
    }

    let items = rewards.map(r => {
        // เช็คว่าเป็นกาชาหรือไม่? (ดูจาก type หรือการมี gacha_data)
        const isGacha = r.type === 'random_box' || (r.gacha_data && r.gacha_data.length > 0);

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
            else if (endTime.seconds) endTime = endTime.seconds * 1000;
            
            if (Date.now() < endTime) {
                pDiscount = parseInt(s.buff_discount_val || 0);
            }
        }
        
        const totalDiscount = Math.min(100, guildDiscount + pDiscount);
        let finalPoints = r.points;
        if (r.points > 0 && totalDiscount > 0) {
            finalPoints = Math.ceil(r.points * (100 - totalDiscount) / 100);
        }

        // --- ✅ [แก้ตรงนี้] เช็คโควตา (เฉพาะสินค้าทั่วไป) ---
        let isQuotaFull = false;
        let remainingQuota = -1;

        // ถ้าไม่ใช่กาชา ให้เช็คโควตาตามปกติ
        if (!isGacha && r.quota > 0) {
            const currentRedeemed = (s.redeemed_history && s.redeemed_history[r.id]) || 0;
            remainingQuota = r.quota - currentRedeemed;
            
            if (remainingQuota <= 0) {
                isQuotaFull = true;
                remainingQuota = 0;
            }
        }
        // ถ้าเป็นกาชา ปล่อยผ่านเรื่องโควตา (isQuotaFull = false เสมอ)

        const isGain = r.points < 0;
        const canAfford = s.points >= finalPoints;
        const isUnlimited = (r.stock === -1 || r.stock === '-1');
        const hasStock = isUnlimited || parseInt(r.stock) > 0;
        
        // Available ถ้า: (เงินพอ หรือ แจก) และ (มีของ) และ (โควตาไม่เต็ม)
        const available = (canAfford || isGain) && hasStock && !isQuotaFull;

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
            isGacha // ส่งค่าไปใช้ตอนวาดปุ่ม
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

        // Logic ปุ่ม
        let btnText = r.isGain ? '🎁 รับเลย' : '💰 แลกเลย';
        let btnClass = r.isGain ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-green-500 hover:bg-green-600';
        
        // ถ้าเป็นกาชา เปลี่ยนปุ่มเป็นสีม่วง
        if (r.isGacha) {
            btnText = '🎲 สุ่มเลย';
            btnClass = 'bg-purple-600 hover:bg-purple-700';
        }

        if (disabled) {
            btnClass = 'bg-gray-300 cursor-not-allowed';
            if (r.isQuotaFull) {
                btnText = '❌ ครบโควตา';
            } else if (!r.hasStock) {
                btnText = '❌ สินค้าหมด';
            } else if (!r.canAfford && !r.isGain) {
                btnText = '🔒 แต้มไม่พอ';
            }
        }

        // --- ✅ [แก้ตรงนี้] การแสดงผลป้ายโควตา ---
        let quotaLabel = '';
        
        // แสดงเฉพาะสินค้าที่ไม่ใช่กาชา และมีการจำกัดโควตา
        if (!r.isGacha && r.quota > 0) {
            if (r.isQuotaFull) {
                quotaLabel = `<div class="text-[10px] text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-full border border-red-100">เต็มแล้ว (${r.quota}/${r.quota})</div>`;
            } else {
                quotaLabel = `<div class="text-[10px] text-blue-500 font-bold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">เหลือ ${r.remainingQuota} สิทธิ์</div>`;
            }
        } else if (r.isGacha) {
            // ถ้าเป็นกาชา ไม่ต้องโชว์อะไร (หรืออยากโชว์ว่า "ไม่อั้น" ก็แก้ตรงนี้ได้)
            quotaLabel = ''; 
        } else {
             quotaLabel = `<div class="text-[10px] text-gray-400">ไม่จำกัดโควตา</div>`;
        }

        // เลือกฟังก์ชันที่จะเรียก (กาชา หรือ แลกปกติ)
        let clickAction = `selectRewardForRedeem('${r.id}', ${r.finalPoints})`;
        if (r.isGacha) {
            clickAction = `spinGacha('${r.id}')`;
        }

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

window.confirmRedeemAction = async () => {
    // 1. ดึงข้อมูลตัวแปร
    const qty = parseInt(document.getElementById('redeem-qty').value);
    if (qty <= 0) return alert('กรุณาระบุจำนวนสินค้าอย่างน้อย 1 ชิ้น');
    if (!redeemTarget || !selectedStudentForRedeem) return;

    const reward = redeemTarget;
    const student = selectedStudentForRedeem;
    const totalCost = qty * reward.actualPrice; // ราคาหลังหักส่วนลด
    
    const isUnlimited = reward.stock === -1;
    const isGacha = reward.type === 'gacha_custom'; // เช็คว่าเป็นกาชาไหม

    // --- 2. ตรวจสอบความพร้อม (Basic Check) ---
    if (student.red_cards > 0 && reward.effect !== 'remove_redcard') return alert('❌ มีใบแดงติดตัว แลกของไม่ได้ครับ');
    if (student.points < totalCost) return alert('❌ แต้มไม่พอครับ');
    if (!isUnlimited && reward.stock < qty) return alert(`❌ ของหมด (เหลือ ${reward.stock} ชิ้น)`);

    // --- 3. 🛡️ Logic แยกสาย: กาชา vs ของทั่วไป ---
    
    if (isGacha) {
        // ✅ [Gacha Rule] จำกัดการถือครองในกระเป๋า (Inventory Limit)
        const MAX_SLOTS = 3;
        const currentInv = student.inventory || [];
        
        // นับเฉพาะ "กล่องสุ่ม" ที่ยังไม่ได้เปิด (เผื่อในอนาคตมีไอเทมอื่น)
        const boxCount = currentInv.filter(i => i.type === 'gacha_box').length;
        
        if (boxCount + qty > MAX_SLOTS) {
            return alert(`❌ กระเป๋าเต็ม! (ถือได้สูงสุด ${MAX_SLOTS} กล่อง)\n\nตอนนี้มีอยู่: ${boxCount} กล่อง\nกำลังจะซื้อเพิ่ม: ${qty} กล่อง\n\n💡 กรุณาไปเปิดกล่องที่มีอยู่ก่อนครับ!`);
        }
        // (หมายเหตุ: เราไม่เช็ค reward.quota สำหรับกาชาแล้ว ปล่อยฟรีเลย)

    } else {
        // ✅ [Normal Rule] เช็คโควตาต่อคนตามปกติ
        if (reward.quota > 0) {
            const currentRedeemed = (student.redeemed_history && student.redeemed_history[reward.id]) || 0;
            if (currentRedeemed + qty > reward.quota) {
                return alert(`❌ เกินโควตา! คุณแลกไปแล้ว ${currentRedeemed}/${reward.quota} ชิ้น`);
            }
        }
    }

    // --- 4. เตรียมข้อมูลบันทึก (Batch Write) ---
    const batch = writeBatch(db);
    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', student.id);
    const rRef = doc(db, 'artifacts', appId, 'public', 'data', 'rewards', reward.id);
    const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

    // อัปเดตข้อมูลนักเรียน (ตัดแต้ม)
    const updateData = { points: increment(-totalCost) };

    if (isGacha) {
        // ✅ [Gacha] สร้างไอเท็มเข้ากระเป๋า (Inventory)
        const newItems = [];
        for(let i=0; i<qty; i++) {
            newItems.push({
                instance_id: crypto.randomUUID(), // ID เฉพาะของกล่องนี้ (ไม่ซ้ำใคร)
                reward_id: reward.id,
                name: reward.name,
                image: reward.image || '',
                type: 'gacha_box', // ระบุประเภทให้ชัดเจน
                obtained_at: Date.now()
            });
        }
        // ใช้ arrayUnion เพื่อยัดของใหม่ต่อท้าย Array เดิม
        updateData.inventory = arrayUnion(...newItems);
        
    } else {
        // [Normal] อัปเดตประวัติการแลก (Quota Count)
        const redeemedKey = `redeemed_history.${reward.id}`;
        updateData[redeemedKey] = increment(qty);
    }

    batch.update(sRef, updateData);

    // ตัดสต็อก (ถ้ามีจำกัด)
    if (!isUnlimited) {
        batch.update(rRef, { stock: increment(-qty) });
    }
    
    // บันทึก History
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

        // --- 5. อัปเดตหน้าจอทันที (Local Update) ---
        student.points -= totalCost;

        if (isGacha) {
            // อัปเดตกระเป๋า Local
            if (!student.inventory) student.inventory = [];
            // สร้าง Mock Item เพื่อให้หน้าจอเห็นว่ามีของเพิ่ม
            for(let i=0; i<qty; i++) {
                student.inventory.push({ type: 'gacha_box', reward_id: reward.id });
            }
        } else {
            // อัปเดตโควตา Local
            if (!student.redeemed_history) student.redeemed_history = {};
            const oldQty = student.redeemed_history[reward.id] || 0;
            student.redeemed_history[reward.id] = oldQty + qty;
        }

        if (!isUnlimited) {
            reward.stock -= qty;
        }

        hideRedeemQuantityModal();
        showToast(`✅ แลกสำเร็จ! (-${totalCost} แต้ม)`);
        
        // รีเฟรชหน้าจอร้านค้า
        if(typeof renderShopGrid === 'function') renderShopGrid();

    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

    
// 5. Bank Logic
// ฟังก์ชันคำนวณดอกเบี้ย (แก้ไข: รองรับบัฟส่วนตัวแบบ Override)
// ฟังก์ชันคำนวณดอกเบี้ย (ฉบับอัปเกรด: ทบทุกบัฟ! 🚀)
function calculatePendingInterest(student) {
    // 1. 🔒 เช็คใบเตือน: ถ้ามีใบเตือน ดอกเบี้ยเป็น 0 เสมอ
    if ((student.warning_cards || 0) > 0) return 0;

    if (!student.bank_points || !student.bank_deposit_time) return 0;

    let depositTime = student.bank_deposit_time;
    if (depositTime && typeof depositTime.toMillis === 'function') depositTime = depositTime.toMillis();
    else if (depositTime instanceof Date) depositTime = depositTime.getTime();
    else if (depositTime.seconds) depositTime = depositTime.seconds * 1000;
    else return 0;

    const now = Date.now();
    const hours = (now - depositTime) / (1000 * 60 * 60);
    if (isNaN(hours) || hours < 0) return 0;

    // --- เริ่มรวมพลังบัฟ ---
    
    // 1. เรทพื้นฐาน
    let totalRate = config.interest_rate || 1.0;

    // 2. บวกบัฟกิลด์
    if (student.guild_id && typeof getGuildActiveBuffs === 'function') {
        const activeBuffs = getGuildActiveBuffs(student.guild_id);
        if (activeBuffs && activeBuffs.interest) {
            totalRate += parseFloat(activeBuffs.interest);
        }
    }

    // 3. บวกบัฟส่วนตัว (ถ้ามีและยังไม่หมดอายุ)
    if (student.special_interest_end) {
        let endTime = student.special_interest_end;
        if (typeof endTime.toMillis === 'function') endTime = endTime.toMillis();
        else if (endTime instanceof Date) endTime = endTime.getTime();
        else if (endTime.seconds) endTime = endTime.seconds * 1000;

        if (now < endTime) {
            // 🔥 เปลี่ยนจาก = เป็น += (บวกทบเข้าไปเลย!)
            totalRate += parseFloat(student.special_interest_rate || 0);
        }
    }

    // คำนวณยอดเงินสุดท้าย
    return student.bank_points * (totalRate / 100) * hours;
}

let currentBankTarget = null;

// ==========================================
// 🏦 OPEN BANK MODAL (แก้ไข: ให้เด็กกดเปิดได้)
// ==========================================
// ==========================================
// 🏦 OPEN BANK MODAL (แก้ไข: รองรับการเรียกแบบไม่ระบุ ID)
// ==========================================
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
    const currentBank = s.bank_points || 0;
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
    const currentPrincipal = s.bank_points || 0;
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

window.deleteStudent = async (id) => {
    if(confirm('ยืนยันลบนักเรียนคนนี้?')) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', id));
    }
}

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

// --- REPORT & CHART LOGIC ---
let pointsChartInstance = null;
let redCardsChartInstance = null;

// ✅ 1. คำนวณและแสดงตารางรายงาน (เปลี่ยนเป็นใบเตือน)
window.renderClassReport = () => {
    // 1. Group Data by Class
    const classStats = {};
    
    students.forEach(s => {
        const cls = s.class_name ? s.class_name.trim() : 'ไม่ระบุ';
        // เปลี่ยนจาก red_cards เป็น warning_cards
        if (!classStats[cls]) {
            classStats[cls] = { name: cls, count: 0, points: 0, warning_cards: 0 };
        }
        classStats[cls].count++;
        classStats[cls].points += (s.points || 0);
        classStats[cls].warning_cards += (s.warning_cards || 0);
    });

    // Convert to Array & Sort by Name
    const reportData = Object.values(classStats).sort((a, b) => a.name.localeCompare(b.name, 'th'));

    // 2. Render Table
    const tbody = document.getElementById('report-class-list');
    tbody.innerHTML = reportData.map(c => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 font-bold text-gray-800">${c.name}</td>
            <td class="px-6 py-4 text-center">${c.count} คน</td>
            <td class="px-6 py-4 text-center font-bold text-blue-600">${c.points.toLocaleString()}</td>
            <td class="px-6 py-4 text-center text-gray-500">${(c.points / c.count).toFixed(2)}</td>
            <td class="px-6 py-4 text-center font-bold ${c.warning_cards > 0 ? 'text-yellow-600' : 'text-gray-300'}">${c.warning_cards}</td>
        </tr>
    `).join('');

    // 3. Render Charts
    renderCharts(reportData);
};

// ✅ 2. สร้างกราฟ (เปลี่ยนกราฟขวาเป็นใบเตือน สีเหลือง)
function renderCharts(data) {
    // Prepare Data
    const labels = data.map(d => d.name);
    const pointsData = data.map(d => d.points);
    const warningsData = data.map(d => d.warning_cards); // ใช้ข้อมูลใบเตือน

    // Destroy old instances if exist
    if (pointsChartInstance) pointsChartInstance.destroy();
    if (redCardsChartInstance) redCardsChartInstance.destroy();

    // Chart 1: Points (เหมือนเดิม)
    const ctxPoints = document.getElementById('chart-points').getContext('2d');
    pointsChartInstance = new Chart(ctxPoints, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'แต้มรวม',
                data: pointsData,
                backgroundColor: 'rgba(59, 130, 246, 0.6)',
                borderColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 1
            }]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });

    // Chart 2: Warning Cards (เปลี่ยนสีและข้อมูล)
    const ctxRed = document.getElementById('chart-redcards').getContext('2d'); // ใช้ ID เดิมก็ได้ ไม่ต้องแก HTML
    redCardsChartInstance = new Chart(ctxRed, {
        type: 'line', 
        data: {
            labels: labels,
            datasets: [{
                label: 'ใบเตือนรวม', // เปลี่ยนป้ายชื่อ
                data: warningsData,
                backgroundColor: 'rgba(234, 179, 8, 0.2)', // สีเหลือง (Yellow-500)
                borderColor: 'rgba(234, 179, 8, 1)',
                borderWidth: 2,
                tension: 0.3,
                fill: true
            }]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

// ✅ 3. Export CSV (อัปเดตหัวตารางและข้อมูล)
window.exportClassReportCSV = () => {
    // Recalculate Data for Export
    const classStats = {};
    students.forEach(s => {
        const cls = s.class_name ? s.class_name.trim() : 'ไม่ระบุ';
        if (!classStats[cls]) classStats[cls] = { name: cls, count: 0, points: 0, warning_cards: 0 };
        classStats[cls].count++;
        classStats[cls].points += (s.points || 0);
        classStats[cls].warning_cards += (s.warning_cards || 0);
    });
    const reportData = Object.values(classStats).sort((a, b) => a.name.localeCompare(b.name, 'th'));

    // CSV Header (เปลี่ยน "จำนวนใบแดง" -> "จำนวนใบเตือน")
    let csvContent = "\uFEFFชั้นเรียน,จำนวนนักเรียน,แต้มรวม,คะแนนเฉลี่ย,จำนวนใบเตือน\n";
    
    reportData.forEach(row => {
        const avg = (row.points / row.count).toFixed(2);
        csvContent += `${row.name},${row.count},${row.points},${avg},${row.warning_cards}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "classroom_report.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// Update switchTab to render report when clicked
const originalSwitchTab = window.switchTab;
window.switchTab = (tabName) => {
    originalSwitchTab(tabName);
    if (tabName === 'report') {
        renderClassReport();
    }
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

    const targetIds = currentQuestTargetId ? [currentQuestTargetId] : Array.from(selectedStudentIds);

    targetIds.forEach(sid => {
        const s = students.find(std => std.id === sid);
        
        if (s) {
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', sid);
            const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
            
            // 🔥 เรียกใช้ฟังก์ชันคำนวณบัฟตรงนี้!
            const { totalPoints, bonusPoints, bonusPercent } = calculateQuestPointsWithBuffs(s, baseTotalPoints);
            totalBonusGiven += bonusPoints;

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
    const quotaInput = document.getElementById('add-reward-quota');
    if (quotaInput && quotaInput.parentElement) {
         // ซ่อนทั้งก้อน (Label + Input + Checkbox)
         quotaInput.parentElement.classList.toggle('hidden', isGacha);
    }
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
            <select class="border rounded text-sm px-2 py-1 bg-gray-50 flex-1 slot-type" onchange="updateSlotInputs(this)">
                <option value="points">💰 สุ่มแต้ม (ช่วง Min-Max)</option>
                <option value="points_fix">💎 สุ่มแต้ม (Fix ค่าเดียว)</option>
                <option value="interest">📈 ดอกเบี้ยพิเศษ</option>
                <option value="buff_discount">🏷️ บัฟส่วนลดร้านค้า</option> 
                <option value="buff_points">🚀 บูสต์แต้ม (Multiplier)</option>
                <option value="reward_ref">🎁 ของในร้าน</option>
                <option value="text">💬 ข้อความ/กำหนดเอง</option>
                <option value="salt">🧂 เกลือ (ไม่ได้อะไรเลย)</option> 
            </select>
            <div class="flex items-center gap-1 w-24">
                <input type="number" step="0.01" class="border rounded text-sm px-2 py-1 w-full text-center font-bold text-blue-600 slot-chance" placeholder="%" oninput="updateTotalChance()">
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
                    <span>ส่วนลด</span> <input type="number" min="1" max="100" class="border rounded w-20 px-2 py-1 slot-value font-bold text-red-500" placeholder="%"> %
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
                    <span>ดอกเบี้ย</span> <input type="number" step="0.001" min="0.001" class="border rounded w-24 px-2 py-1 slot-rate font-bold text-green-600" placeholder="%"> %
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
    const quotaInput = document.getElementById('edit-reward-quota');
    if (quotaInput && quotaInput.parentElement) {
         quotaInput.parentElement.classList.toggle('hidden', isGacha);
    }
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
            <select class="border rounded text-sm px-2 py-1 bg-gray-50 flex-1 slot-type" onchange="updateEditSlotInputs(this)">
                <option value="points">💰 สุ่มแต้ม (ช่วง Min-Max)</option>
                <option value="points_fix">💎 สุ่มแต้ม (Fix ค่าเดียว)</option>
                <option value="interest">📈 ดอกเบี้ยพิเศษ</option>
                <option value="buff_discount">🏷️ บัฟส่วนลดร้านค้า</option>
                <option value="buff_points">🚀 บูสต์แต้ม (Multiplier)</option>
                 <option value="reward_ref">🎁 ของในร้าน</option>
                <option value="text">💬 ข้อความ/กำหนดเอง</option>
                <option value="salt">🧂 เกลือ (ไม่ได้อะไรเลย)</option>
            </select>
            <div class="flex items-center gap-1 w-24">
                <input type="number" step="0.01" class="border rounded text-sm px-2 py-1 w-full text-center font-bold text-blue-600 slot-chance" placeholder="%" oninput="updateEditTotalChance()">
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
                    <span>ส่วนลด</span> <input type="number" min="1" max="100" class="border rounded w-20 px-2 py-1 slot-value font-bold text-red-500" placeholder="%"> %
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
                <span>ดอกเบี้ย</span> <input type="number" step="0.001" min="0.001" class="border rounded w-24 px-2 py-1 slot-rate font-bold text-green-600" placeholder="%"> %
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
    let quota = 0;
    if (type !== 'gacha_custom') {
        const isQuotaUnlimited = document.getElementById('add-reward-quota-unlimited').checked;
        quota = isQuotaUnlimited ? 0 : (parseInt(document.getElementById('add-reward-quota').value) || 0);
    }

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
window.confirmRedeemAction = async () => {
    const qty = parseInt(document.getElementById('redeem-qty').value);
    const totalCost = qty * redeemTarget.points;
    const student = selectedStudentForRedeem;
    const reward = redeemTarget;
    const isUnlimited = reward.stock === -1;

    if (!student) return;
    if (student.red_cards > 0 && reward.effect !== 'remove_redcard') return alert('มีใบแดงติดตัว แลกของไม่ได้ครับ (ยกเว้นไอเทมล้างใบแดง)');
    if (student.points < totalCost) return alert('แต้มไม่พอครับ');
    if (!isUnlimited && reward.stock < qty) return alert('ของหมดครับ');

    const batch = writeBatch(db);
    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', student.id);
    const rRef = doc(db, 'artifacts', appId, 'public', 'data', 'rewards', reward.id);
    const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

    // Deduct points
    batch.update(sRef, { points: increment(-totalCost) });
    if (!isUnlimited) batch.update(rRef, { stock: increment(-qty) });


    // Check if Item -> Add to Inventory
    if (reward.type === 'item' || reward.type === 'gacha_custom') {
        // Add items one by one (or push multiple)
        const newItems = Array(qty).fill().map(() => ({
            id: crypto.randomUUID(), // Unique ID for each item instance
            reward_id: reward.id,
            name: reward.name,
            image: reward.image,
            type: reward.type === 'gacha_custom' ? 'gacha_box' : 'general_item',
            effect: reward.effect,
            acquired_at: Date.now(),
            gacha_pool: reward.gacha_pool || null
        }));
        batch.update(sRef, { inventory: arrayUnion(...newItems) });
        
        batch.set(hRef, {
            student_id: student.id,
            student_name: student.full_name,
            action: `ซื้อไอเทม: ${reward.name} (x${qty})`,
            amount: totalCost,
            type: 'buy_item',
            timestamp: serverTimestamp()
        });
    } else {
        // General Reward Logic
        const redeemedKey = `redeemed_history.${reward.id}`;
        batch.update(sRef, { [redeemedKey]: increment(qty) });
        batch.set(hRef, {
            student_id: student.id,
            student_name: student.full_name,
            action: `แลกรางวัล: ${reward.name} (x${qty})`,
            amount: totalCost,
            type: 'redeem',
            timestamp: serverTimestamp(),
            meta: { reward_id: reward.id, qty: qty, is_unlimited: isUnlimited }
        });
    }

    await batch.commit();
    hideRedeemQuantityModal();
    showToast('ทำรายการสำเร็จ!');
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
${item.image || '🎟'}
            </div>
            <div class="font-bold text-xs text-center text-gray-700 leading-tight">${item.name}</div>
            </div>
    `).join('');
}

// Update Student Dashboard Render
const originalRenderDash = window.renderStudentDashboard || (() => {});
window.renderStudentDashboard = () => {
    // Run original logic (copy-pasted manually inside original function if needed, or overwrite)
    // Since we can't easily hook, let's assume you update the original function to call renderStudentInventory(s)
    if (!currentStudentData) return;
    // ... (Original Code) ...
    // Add this line at the end of original renderStudentDashboard:
    renderStudentInventory(currentStudentData);
    
    // *IMPORTANT*: Re-run original DOM updates from the snippet provided in file
    // For simplicity, I recommend finding renderStudentDashboard and pasting the renderStudentInventory call at the bottom of it.
    
    // Re-implementing parts for safety:
    document.getElementById('std-dash-points').textContent = Math.floor(currentStudentData.points);
    // ... other UI updates ...
};

// Item Usage Logic
// Item Usage Logic (ฉบับอัปเกรด: เพิ่มระบบเรทสุ่มรางวัลใหญ่ยาก) [cite: 658-673]
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

    const inventoryItem = s.inventory.find(i => i.id === itemId);
    if(!inventoryItem) return alert('ไอเทมหายไปแล้ว');

    // เตรียมตัวแปร Database
    const batch = writeBatch(db);
    const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
    const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

    // ลบไอเทมเดิมออกก่อน (ใช้แล้วต้องหายไป)
    const newInventory = s.inventory.filter(i => i.id !== itemId);
    batch.update(sRef, { inventory: newInventory });

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
        // --- โหมดเปิดกล่องสุ่ม ---
        logMsg = `เปิดกล่องสุ่ม: ${itemName}`;
        const roll = Math.random() * 100;
        let cumulative = 0;
        let wonSlot = null;
        
        // ใช้ pool ที่เราดึงมา (ไม่ใช่ masterReward.gacha_pool)
        for (let slot of pool) { 
            cumulative += slot.chance;
            if (roll < cumulative) { wonSlot = slot; break; }
        }

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
                const days = (wonSlot.hours / 24).toFixed(1).replace('.0', '');
                newCard.name = `บัตรดอกเบี้ยเทพ ${wonSlot.rate}% (${days} วัน)`;
                newCard.type = 'instant_interest';
                newCard.rate = wonSlot.rate;
                newCard.hours = wonSlot.hours;
                newCard.image = '📈';
                resultIcon = '📈';
                resultTitle = `ดอกเบี้ย ${wonSlot.rate}% นาน ${days} วัน!`;
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
            batch.update(sRef, { points: increment(pts) });
            logMsg = `ใช้การ์ดแต้ม: ได้รับ ${pts} คะแนน`;
            alertMsg = `เพิ่ม ${pts} แต้มเรียบร้อย`;
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
            const interest = calculatePendingInterest(s);
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
            <button onclick="useItem('${item.id}', '${item.name}')" 
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

// 1. เพิ่ม Collection Reference (วางต่อจาก const collections = { ... }) [cite: 224-225]
// * ต้องแก้ตัวแปร collections เดิม หรือเพิ่มบรรทัดนี้ในฟังก์ชัน collections เดิม *
// collections.guilds = () => collection(db, 'artifacts', appId, 'public', 'data', 'guilds');
// เพื่อความง่าย ให้เพิ่มฟังก์ชันนี้แยกออกมา หรือไปแก้ในตัวแปร collections ด้านบนครับ


let guilds = [];

// 2. Subscribe ข้อมูลกิลด์ (เรียกใช้ใน initAppUI หรือ subscribeToData)
// เพิ่มบรรทัดนี้ในฟังก์ชัน subscribeToData() [cite: 264-299]
/*
unsubscribers.push(onSnapshot(getGuildsCol(), (snapshot) => {
    guilds = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if(userRole === 'teacher') renderGuildsDashboard();
}, onError));
*/

// 3. ฟังก์ชันหลัก
window.showCreateGuildModal = () => document.getElementById('create-guild-modal').classList.remove('hidden');

window.handleCreateGuild = async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-guild-name').value;
    const icon = document.getElementById('new-guild-icon').value || '🛡️';
    const cooldown = parseInt(document.getElementById('new-guild-cooldown').value) || 0;
    const fee = parseInt(document.getElementById('new-guild-fee').value) || 0;
    
    try {
        await addDoc(collections.guilds(), {
            name: name,
            icon: icon,
            rule_cooldown: cooldown,
            rule_fee: fee,
            created_at: serverTimestamp()
        });
        document.getElementById('create-guild-modal').classList.add('hidden');
        e.target.reset();
        showToast('สร้างกิลด์เรียบร้อย! ไปเพิ่มสมาชิกได้เลย');
    } catch (err) {
        alert('Error: ' + err.message);
    }
};

// ฟังก์ชันแสดงหน้ากิลด์ (ค้นหาเทพๆ: ชื่อกิลด์ + ชื่อสมาชิก + เลขประจำตัว + ชั้นเรียน)
window.renderGuildsDashboard = (resetPage = true) => {
    if (resetPage) paginationState.guilds = 1;

    const board = document.getElementById('guild-leaderboard');
    const listBody = document.getElementById('guild-list-body');
    
    // อัปเดต Placeholder ให้รู้ว่าค้นหาอะไรได้บ้าง
    const searchInput = document.getElementById('guild-search-input');
    if (searchInput) {
         searchInput.placeholder = "ค้นหาชื่อกิลด์, สมาชิก, เลขประจำตัว หรือชั้นเรียน...";
    }
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    if(!board || !listBody) return;

    // 1. คำนวณ Stat และเตรียมข้อมูลสำหรับ Search Engine
    const guildStats = guilds.map(g => {
        const members = students.filter(s => s.guild_id === g.id);
        const totalPoints = members.reduce((sum, s) => sum + (s.points || 0), 0);
        
        // 🔥 รวมพลัง Search: เอาทุกอย่างมายำรวมกันเป็นก้อนเดียว
        // - ชื่อสมาชิก (full_name)
        // - เลขประจำตัว (student_id)
        // - ชั้นเรียน (class_name)
        const searchContext = members.map(s => 
            `${s.full_name} ${s.student_id || ''} ${s.class_name || ''}`
        ).join(' ').toLowerCase();
        
        return { 
            ...g, 
            memberCount: members.length, 
            totalPoints: totalPoints,
            // เอาชื่อกิลด์มารวมกับข้อมูลสมาชิกเพื่อใช้ค้นหา
            fullSearchText: `${g.name.toLowerCase()} ${searchContext}`
        };
    });

    // 2. เรียงลำดับตามแต้มรวม (Top 3)
    guildStats.sort((a, b) => b.totalPoints - a.totalPoints);

    // 3. Render Top 3 Cards (คงเดิม)
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
            <p class="text-3xl font-black mb-2">${g.totalPoints.toLocaleString()}</p>
            <div class="text-[10px] font-bold bg-white/60 rounded-lg px-2 py-1 space-y-0.5 w-full text-center">
                ${buffText || '- ไม่มีบัฟ -'}
            </div>
        </div>`;
    }).join('');

    // 4. กรองข้อมูล (ค้นหาจากก้อน fullSearchText ที่เตรียมไว้)
    const filteredGuilds = guildStats.filter(g => g.fullSearchText.includes(searchTerm));

    // 5. แบ่งหน้า (Pagination)
    const { data: paginatedData } = getPaginatedData(filteredGuilds, paginationState.guilds);

    // 6. Render List Table (Logic เดิม)
    if (paginatedData.length === 0) {
        listBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-400">ไม่พบกิลด์ที่ค้นหา</td></tr>`;
    } else {
        listBody.innerHTML = paginatedData.map(g => {
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
                <td class="px-6 py-4 text-center font-bold text-gray-800 group-hover:text-indigo-600">${g.totalPoints.toLocaleString()}</td>
                <td class="px-6 py-4 text-center">
                    <button class="text-indigo-600 hover:bg-indigo-100 p-2 rounded-full">⚙️ จัดการ</button>
                </td>
            </tr>
        `}).join('');
    }

    // 7. Render Pagination Controls
    const paginationContainer = document.getElementById('pagination-guilds');
    if (paginationContainer) {
        paginationContainer.innerHTML = renderPaginationControls(filteredGuilds.length, 'guilds');
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
    
    // โหลดค่าบัฟ
    document.getElementById('guild-buff-interest').value = g.buff_interest.toFixed(2) || 0;
    document.getElementById('guild-buff-discount').value = g.buff_discount || 0;

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
        if (ruleCooldown > 0 && s.guild_id) {
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
// ฟังก์ชันบันทึกข้อมูลกิลด์ (เวอร์ชั่น: Hard Lock 🔒)
// ==========================================
// ==========================================
// ฟังก์ชันบันทึกข้อมูลกิลด์ (Final Fix: จับเวลาแม่นยำ 🎯)
// ==========================================
// ==========================================
// ฟังก์ชันบันทึกข้อมูลกิลด์ (เพิ่ม: บันทึกประวัติค่าปรับ 📝)
// ==========================================
// ==========================================
// ฟังก์ชันบันทึกกิลด์ (Final V.2: ดักจับคนย้ายค่าย 🔀)
// ==========================================
// ==========================================
// 🎨 Helper: ฟังก์ชันเรียก Modal แจ้งเตือนแบบสวย
// ==========================================
// ==========================================
// 🎨 Helper: Modal แจ้งเตือน (Strict Mode)
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
// ==========================================
// ฟังก์ชันบันทึกกิลด์ (ฉบับแก้ Path ผิดซอย 🛣️✅)
// ==========================================
window.saveGuildData = async () => {
    if(!currentManageGuildId) return;

    // รับค่า Config
    const newName = document.getElementById('edit-guild-name').value.trim();
    const newIcon = document.getElementById('edit-guild-icon').value.trim();
    const buffInterest = parseFloat(document.getElementById('guild-buff-interest').value) || 0;
    const buffDiscount = parseInt(document.getElementById('guild-buff-discount').value) || 0;
    const ruleCooldown = parseInt(document.getElementById('edit-guild-cooldown').value) || 0;
    const ruleFee = parseInt(document.getElementById('edit-guild-fee').value) || 0;
    
   

    // เช็คโควตา
    const maxLimit = (config && config.max_guild_members) ? parseInt(config.max_guild_members) : 0;
    if (maxLimit > 0 && tempGuildSelection.size > maxLimit) {
        alert(`❌ สมาชิกเกิน! รับได้สูงสุด ${maxLimit} คน`);
        return;
    }

    try {
        const currentMembers = students.filter(s => s.guild_id === currentManageGuildId);
        const newMemberIds = Array.from(tempGuildSelection);
        
        // หาคนเข้า/ย้ายมา และ คนออก
        const joiners = newMemberIds.map(id => students.find(s => s.id === id)).filter(s => s && !currentMembers.find(m => m.id === s.id));
        const leavers = currentMembers.filter(m => !newMemberIds.includes(m.id));

        // --- ตรวจสัญญา ---
        const lockedList = []; 
        const penaltyList = []; 
        let penaltyTotal = 0;
        const now = Date.now();
        const cooldownMs = ruleCooldown * 60 * 60 * 1000;

        const checkContract = (s) => {
            if (ruleCooldown <= 0 || !s.guild_id) return; 
            let joinedTime = 0;
            if (s.guild_joined_at) {
                if (typeof s.guild_joined_at.toMillis === 'function') joinedTime = s.guild_joined_at.toMillis();
                else if (s.guild_joined_at instanceof Date) joinedTime = s.guild_joined_at.getTime();
                else if (s.guild_joined_at.seconds) joinedTime = s.guild_joined_at.seconds * 1000;
            }
            const timeDiff = now - joinedTime;
            if (joinedTime > 0 && timeDiff < cooldownMs) {
                const currentPoints = s.points || 0;
                if (currentPoints < ruleFee) {
                    lockedList.push({ name: s.full_name, missing: (ruleFee - currentPoints).toLocaleString(), hours: Math.ceil((cooldownMs - timeDiff)/3600000) });
                } else {
                    penaltyList.push({ name: s.full_name, id: s.id });
                    penaltyTotal += ruleFee;
                }
            }
        };

        leavers.forEach(s => checkContract(s));
        joiners.forEach(s => { if (s.guild_id && s.guild_id !== currentManageGuildId) checkContract(s); });

        // 🛑 ด่าน 1: ติดล็อก
        if (lockedList.length > 0) {
            await showGuildPenaltyModal('lock', lockedList);
            return;
        }

        // ⚠️ ด่าน 2: ถามยืนยัน
        if (penaltyList.length > 0) {
            const confirmed = await showGuildPenaltyModal('confirm', penaltyList, ruleFee, penaltyTotal);
            if (confirmed !== true) return;
        }

        // --- เริ่มบันทึก ---
        const penaltyIds = penaltyList.map(p => p.id);
        const batch = writeBatch(db);
        const guildRef = doc(db, 'artifacts', appId, 'public', 'data', 'guilds', currentManageGuildId);

        batch.set(guildRef, { name: newName, icon: newIcon,rule_cooldown: ruleCooldown, rule_fee: ruleFee, buff_interest: buffInterest, buff_discount: buffDiscount }, { merge: true });

        // 1. จัดการคนเข้า (Joiners)
        joiners.forEach(s => {
            // 🔴 แก้ Path ตรงนี้ครับ (ใส่ path ยาวๆ ให้ครบ)
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
            const updates = { guild_id: currentManageGuildId, guild_joined_at: new Date() };
            
            if (penaltyIds.includes(s.id)) {
                updates.points = increment(-ruleFee);
                const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
                batch.set(hRef, { student_id: s.id, student_name: s.full_name, action: 'ฉีกสัญญา (ย้ายค่าย)', amount: ruleFee, type: 'remove_points', timestamp: serverTimestamp() });
            }
            batch.set(sRef, updates, { merge: true });
        });

        // 2. จัดการคนออก (Leavers)
        leavers.forEach(s => {
            // 🔴 แก้ Path ตรงนี้ด้วยครับ
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
            const updates = { guild_id: null, guild_joined_at: null };
            
            if (penaltyIds.includes(s.id)) {
                updates.points = increment(-ruleFee); 
                const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());
                batch.set(hRef, { student_id: s.id, student_name: s.full_name, action: 'ฉีกสัญญา (ลาออก)', amount: ruleFee, type: 'remove_points', timestamp: serverTimestamp() });
            }
            batch.set(sRef, updates, { merge: true });
        });

        await batch.commit();
        document.getElementById('manage-guild-modal').classList.add('hidden');
        showToast(`💾 บันทึกเรียบร้อย!`, 'success');
        
        // UI Refresh
        if(typeof renderGuildsDashboard === 'function') renderGuildsDashboard();
        if(typeof renderStudentList === 'function') renderStudentList(false);
        
    } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาด: ' + err.message);
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
    
    // รับค่ากฎใหม่
    const ruleCooldown = parseInt(document.getElementById('config-guild-cooldown').value) || 0;
    const ruleFee = parseInt(document.getElementById('config-guild-fee').value) || 0;

    try {
        // บันทึกทีละตัว (หรือจะรวม object ก็ได้ แต่อันนี้ชัวร์สุด)
        await saveConfig('max_guild_members', maxMembers);
        await saveConfig('guild_rule_cooldown', ruleCooldown);
        await saveConfig('guild_rule_fee', ruleFee);
        
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
                        gacha_pool: reward.gacha_pool || null
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
                    const studentAns = (d.answers[q.id] || '').trim().toLowerCase();
                    const teacherAns = q.correctAnswer.trim().toLowerCase();
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

// ================= 👥 CUSTOM GROUPS LOGIC (ฉบับแก้ไข Path) =================

let customGroups = [];
let currentGroupMembers = new Set();
let targetGroupId = null;

// 1. โหลดข้อมูลกลุ่ม (แก้ Path ให้มี 6 ท่อน)
try {
    // 🔥 แก้ไขตรงนี้: เพิ่ม 'core' ต่อท้าย เพื่อให้อ้างอิงถึงไฟล์ ไม่ใช่โฟลเดอร์
    const groupsDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'custom_groups', 'core');
    
    onSnapshot(groupsDocRef, (docSnap) => {
        if (docSnap.exists()) {
            customGroups = docSnap.data().list || [];
        } else {
            customGroups = [];
        }
        // ถ้าเปิดหน้ากลุ่มอยู่ ให้วาดใหม่ทันที
        const groupsTab = document.getElementById('content-groups');
        if (groupsTab && !groupsTab.classList.contains('hidden')) {
            renderCustomGroups();
        }
    });
} catch(e) {
    console.error("Error init groups listener:", e);
}

// 2. ฟังก์ชันแสดงรายชื่อกลุ่ม
window.renderCustomGroups = () => {
    const container = document.getElementById('custom-groups-list');
    if (!container) return;

    if (customGroups.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-20 text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl">
                <div class="text-6xl mb-4 opacity-50">👥</div>
                <p class="text-xl font-bold">ยังไม่มีกลุ่ม</p>
                <p class="text-sm">สร้างกลุ่มใหม่เพื่อเริ่มใช้งาน</p>
            </div>`;
        return;
    }

    container.innerHTML = customGroups.map(g => {
        const memberCount = g.student_ids ? g.student_ids.length : 0;
        const bgColors = ['bg-pink-50', 'bg-purple-50', 'bg-indigo-50', 'bg-blue-50', 'bg-teal-50', 'bg-orange-50'];
        const colorClass = bgColors[(g.name.length || 0) % bgColors.length];

        return `
        <div class="relative group p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all ${colorClass}">
            <div class="flex justify-between items-start mb-3">
                <div class="w-14 h-14 bg-white rounded-full flex items-center justify-center text-3xl shadow-sm border border-gray-100">
                    ${g.icon || '👥'}
                </div>
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="openManageGroupModal('${g.id}')" class="p-1.5 bg-white text-gray-500 hover:text-indigo-600 rounded-lg border hover:border-indigo-200 shadow-sm" title="แก้ไข">✏️</button>
                    <button onclick="deleteCustomGroup('${g.id}')" class="p-1.5 bg-white text-gray-500 hover:text-red-500 rounded-lg border hover:border-red-200 shadow-sm" title="ลบ">🗑️</button>
                </div>
            </div>
            
            <h3 class="text-lg font-bold text-gray-800 mb-1 truncate">${g.name}</h3>
            <p class="text-sm text-gray-500 mb-4">${memberCount} สมาชิก</p>
            
            <button onclick="openGroupPointModal('${g.id}')" class="w-full bg-white border-2 border-indigo-100 hover:border-indigo-500 hover:text-indigo-700 text-gray-600 py-2 rounded-xl font-bold transition-all flex items-center justify-center gap-2">
                <span>🎁</span> แจกแต้มกลุ่ม
            </button>
        </div>
        `;
    }).join('');
};

// 3. ฟังก์ชันเปิด Modal
window.openManageGroupModal = (groupId = null) => {
    const modal = document.getElementById('manage-group-modal');
    if(!modal) return console.error('Modal not found');

    const title = document.getElementById('manage-group-title');
    const idInput = document.getElementById('group-id-input');
    const nameInput = document.getElementById('group-name-input');
    const iconInput = document.getElementById('group-icon-input');

    currentGroupMembers.clear();

    if (groupId) {
        const g = customGroups.find(x => x.id === groupId);
        if (!g) return;
        title.textContent = 'แก้ไขกลุ่ม';
        idInput.value = g.id;
        nameInput.value = g.name;
        iconInput.value = g.icon;
        if (g.student_ids) g.student_ids.forEach(id => currentGroupMembers.add(id));
    } else {
        title.textContent = 'สร้างกลุ่มใหม่';
        idInput.value = '';
        nameInput.value = '';
        iconInput.value = '👥';
    }

    renderGroupMemberSelector();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

// 4. ฟังก์ชันเลือกสมาชิก (อัปเดตล่าสุด: เรียงคนเลือกไว้บน + ค้นชั้นเรียน)
window.renderGroupMemberSelector = () => {
    const list = document.getElementById('group-member-list');
    const searchInput = document.getElementById('group-member-search');
    if(!list) return;

    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    let filtered = students.filter(s => 
        s.full_name.toLowerCase().includes(search) || 
        s.student_id.includes(search) ||
        (s.class_name && s.class_name.toLowerCase().includes(search))
    );

    filtered.sort((a, b) => {
        const aSelected = currentGroupMembers.has(a.id);
        const bSelected = currentGroupMembers.has(b.id);
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return a.student_id.localeCompare(b.student_id);
    });

    list.innerHTML = filtered.map(s => {
        const isChecked = currentGroupMembers.has(s.id);
        const classTag = s.class_name ? `<span class="ml-1 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200">${s.class_name}</span>` : '';
        
        return `
        <div onclick="toggleGroupMember('${s.id}')" class="cursor-pointer p-2 rounded border flex items-center gap-2 transition-all ${isChecked ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-200' : 'bg-white border-gray-200 hover:bg-gray-50'}">
            <div class="w-5 h-5 rounded border flex items-center justify-center shrink-0 ${isChecked ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-300'}">
                ${isChecked ? '✓' : ''}
            </div>
            <div class="text-sm truncate select-none flex-1">
                <div class="font-bold text-gray-800 flex items-center">
                    ${s.full_name} ${classTag}
                </div>
                <div class="text-[10px] text-gray-400">เลขประจำตัว: ${s.student_id}</div>
            </div>
            ${isChecked ? '<span class="text-[10px] font-bold text-indigo-500 shrink-0">เลือกแล้ว</span>' : ''}
        </div>`;
    }).join('');
};

window.toggleGroupMember = (sid) => {
    if (currentGroupMembers.has(sid)) currentGroupMembers.delete(sid);
    else currentGroupMembers.add(sid);
    renderGroupMemberSelector();
};

// 5. บันทึกกลุ่ม (แก้ Path ให้ตรงกัน)
window.saveCustomGroup = async () => {
    const id = document.getElementById('group-id-input').value;
    const name = document.getElementById('group-name-input').value.trim();
    const icon = document.getElementById('group-icon-input').value.trim();

    if (!name) return alert('กรุณาใส่ชื่อกลุ่ม');
    if (currentGroupMembers.size === 0) return alert('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');

    const newGroup = {
        id: id || crypto.randomUUID(),
        name,
        icon,
        student_ids: Array.from(currentGroupMembers)
    };

    let newList = [...customGroups];
    if (id) {
        const idx = newList.findIndex(x => x.id === id);
        if (idx !== -1) newList[idx] = newGroup;
    } else {
        newList.push(newGroup);
    }

    try {
        // 🔥 แก้ไข Path ให้มี 'core' ต่อท้าย
        const groupsDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'custom_groups', 'core');
        await setDoc(groupsDocRef, { list: newList });
        document.getElementById('manage-group-modal').classList.add('hidden');
        showToast('บันทึกกลุ่มเรียบร้อย ✅');
    } catch (e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    }
};

// 6. ลบกลุ่ม (แก้ Path ให้ตรงกัน)
window.deleteCustomGroup = async (gid) => {
    if (!confirm('ยืนยันที่จะลบกลุ่มนี้? (ข้อมูลนักเรียนไม่หาย)')) return;
    const newList = customGroups.filter(x => x.id !== gid);
    try {
        // 🔥 แก้ไข Path ให้มี 'core' ต่อท้าย
        const groupsDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'custom_groups', 'core');
        await setDoc(groupsDocRef, { list: newList });
        showToast('ลบกลุ่มแล้ว 🗑️');
    } catch (e) {
        alert('Error: ' + e.message);
    }
};

// --- ส่วนแจกแต้มกลุ่ม ---
window.openGroupPointModal = (gid) => {
    targetGroupId = gid;
    const g = customGroups.find(x => x.id === gid);
    if (!g) return;

    document.getElementById('gp-modal-icon').textContent = g.icon;
    document.getElementById('gp-modal-name').textContent = `แจกแต้มกลุ่ม: ${g.name}`;
    document.getElementById('gp-modal-count').textContent = `สมาชิก ${g.student_ids.length} คน`;

    const listContainer = document.getElementById('gp-member-list');
    if (listContainer) {
        // ซ่อนไว้ก่อนเสมอเมื่อเปิดใหม่ (หรือจะให้โชว์เลยก็ได้ ให้ลบ class hidden ออกจาก HTML แทน)
        listContainer.classList.add('hidden'); 
        
        if (g.student_ids.length > 0) {
            // แปลง ID เป็น ชื่อนักเรียน
            const memberNames = g.student_ids.map(sid => {
                const s = students.find(std => std.id === sid);
                return s ? `<span class="bg-white px-2 py-1 rounded border text-xs text-gray-600">${s.full_name}</span>` : null;
            }).filter(n => n).join(''); // กรอง null ออกแล้วต่อ String
            
            listContainer.innerHTML = `<div class="flex flex-wrap gap-2 justify-center">${memberNames}</div>`;
        } else {
            listContainer.innerHTML = '<div class="text-center text-gray-400 text-xs">- ไม่มีสมาชิก -</div>';
        }
    }
    document.getElementById('gp-amount').value = 10;
    document.getElementById('gp-reason').value = '';
    
    const select = document.getElementById('gp-mission-select');
    select.innerHTML = '<option value="">-- เลือกภารกิจ --</option>' + 
        quests.map(q => `<option value="${q.id}">[${q.category||'ทั่วไป'}] ${q.title} (+${q.points})</option>`).join('');

    switchGroupPointTab('custom');
    document.getElementById('group-point-modal').classList.remove('hidden');
};

window.switchGroupPointTab = (tab) => {
    const tCustom = document.getElementById('gp-tab-custom');
    const tMission = document.getElementById('gp-tab-mission');
    const cCustom = document.getElementById('gp-content-custom');
    const cMission = document.getElementById('gp-content-mission');

    if (tab === 'custom') {
        tCustom.classList.replace('border-transparent', 'border-indigo-600');
        tCustom.classList.replace('text-gray-500', 'text-indigo-600');
        tMission.classList.replace('border-indigo-600', 'border-transparent');
        tMission.classList.replace('text-indigo-600', 'text-gray-500');
        cCustom.classList.remove('hidden');
        cMission.classList.add('hidden');
    } else {
        tMission.classList.replace('border-transparent', 'border-indigo-600');
        tMission.classList.replace('text-gray-500', 'text-indigo-600');
        tCustom.classList.replace('border-indigo-600', 'border-transparent');
        tCustom.classList.replace('text-indigo-600', 'text-gray-500');
        cMission.classList.remove('hidden');
        cCustom.classList.add('hidden');
    }
};

window.onGroupMissionSelect = () => {
    const mid = document.getElementById('gp-mission-select').value;
    const preview = document.getElementById('gp-mission-preview');
    if (!mid) {
        preview.classList.add('hidden');
        return;
    }
    const q = quests.find(x => x.id === mid);
    if (q) {
        document.getElementById('gp-mp-icon').textContent = q.icon;
        document.getElementById('gp-mp-title').textContent = q.title;
        document.getElementById('gp-mp-points').textContent = `+${q.points} แต้ม`;
        preview.classList.remove('hidden');
    }
};

window.confirmGroupPoints = async () => {
    const g = customGroups.find(x => x.id === targetGroupId);
    if (!g || !g.student_ids || g.student_ids.length === 0) return alert('กลุ่มนี้ไม่มีสมาชิก');

    let amount = 0;
    let reason = '';
    const isMission = !document.getElementById('gp-content-mission').classList.contains('hidden');

    if (isMission) {
        const mid = document.getElementById('gp-mission-select').value;
        if (!mid) return alert('กรุณาเลือกภารกิจ');
        const q = quests.find(x => x.id === mid);
        amount = parseInt(q.points);
        reason = `ภารกิจกลุ่ม: ${q.title}`;
    } else {
        amount = parseInt(document.getElementById('gp-amount').value);
        reason = document.getElementById('gp-reason').value.trim() || 'รางวัลกลุ่ม';
    }

    if (isNaN(amount) || amount <= 0) return alert('จำนวนแต้มต้องมากกว่า 0');
    if (!confirm(`ยืนยันแจกแต้ม ${amount} คะแนน ให้สมาชิกกลุ่ม "${g.name}" ทั้ง ${g.student_ids.length} คน?`)) return;

    const batch = writeBatch(db);
    const timestamp = serverTimestamp();
    let count = 0;

    g.student_ids.forEach(sid => {
        const s = students.find(x => x.id === sid);
        if (s) {
            // เรียกฟังก์ชันคำนวณบัฟที่มีอยู่แล้ว
            const finalPoints = typeof calculateBuffedPoints === 'function' ? calculateBuffedPoints(s, amount) : amount;
            
            const sRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.id);
            const hRef = doc(db, 'artifacts', appId, 'public', 'data', 'history', crypto.randomUUID());

            if ((s.warning_cards || 0) > 0) {
                batch.update(sRef, { pending_points: increment(finalPoints) });
            } else {
                batch.update(sRef, { points: increment(finalPoints) });
            }
            
           

            let logReason = reason;
            if (finalPoints > amount) logReason += ` + Boosted 🚀`;

            batch.set(hRef, {
                student_id: s.id,
                student_name: s.full_name,
                action: `รางวัลกลุ่ม (${g.name})`,
                amount: finalPoints,
                type: 'add_points',
                timestamp: timestamp,
                reason: logReason
            });
            count++;
        }
    });

    try {
        await batch.commit();
        document.getElementById('group-point-modal').classList.add('hidden');
        showToast(`✅ แจกแต้มกลุ่มสำเร็จ (${count} คน)`);
        if (window.soundCoin) window.soundCoin.play();
    } catch (e) {
        console.error(e);
        alert('Error: ' + e.message);
    }
};

// ==========================================================
// 🏦 STUDENT BANK SYSTEM (ฝาก-ถอน ฝั่งนักเรียน)
// ==========================================================

let currentStudentBankAction = 'deposit'; // 'deposit' or 'withdraw'


// 1. เปิดหน้าต่างฝากถอน
window.openStudentBankModal = (action) => {
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

// 3. ยืนยันทำรายการ
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
                            🏆 แต้มรวม ${myGuildStats.totalPoints.toLocaleString()}
                        </div>
                        <div class="bg-white/20 px-3 py-1.5 rounded-lg flex items-center gap-2 backdrop-blur-sm">
                            💸 ค่าปรับฉีกสัญญา ${(parseInt(myGuild.rule_fee) || 0).toLocaleString()} แต้ม
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
