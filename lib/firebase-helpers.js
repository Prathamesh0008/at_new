// /lib/firebase-helpers.js
import { db } from './firebase';
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  orderBy,
  Timestamp,
  serverTimestamp 
} from "firebase/firestore";

const toLocalDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// ==================== SAVE DATA TO FIREBASE ====================

/**
 * Save attendance record to Firebase
 */
export const saveAttendanceToFirebase = async (attendanceRecord) => {
  try {
    const attendanceRef = collection(db, "attendance");
    
    const firebaseRecord = {
      ...attendanceRecord,
      employeeId: attendanceRecord.empId,
      employeeName: attendanceRecord.empName,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
      date: attendanceRecord.date || new Date().toISOString().split('T')[0],
      time: attendanceRecord.time || new Date().toLocaleTimeString(),
      workingHours: attendanceRecord.workingHours || '',
      totalBreaks: attendanceRecord.totalBreaks || 0,
      action: attendanceRecord.action,
      shiftType: attendanceRecord.shiftType || 'Regular'
    };
    
    const docRef = await addDoc(attendanceRef, firebaseRecord);
    console.log('✅ Attendance saved to Firebase with ID:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error saving attendance to Firebase:', error);
    throw error;
  }
};

/**
 * Save break record to Firebase
 */
export const saveBreakToFirebase = async (breakRecord) => {
  try {
    const breaksRef = collection(db, "breaks");
    
    const firebaseBreakRecord = {
      ...breakRecord,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
      employeeId: breakRecord.employeeId || breakRecord.empId,
      employeeName: breakRecord.employeeName || breakRecord.empName,
      breakType: breakRecord.breakType,
      exceededBy: breakRecord.exceededBy || 0,
      allowedTime: breakRecord.allowedTime || 0,
      status: breakRecord.exceededBy > 0 ? 'Exceeded' : 'Completed',
    };
    
    const docRef = await addDoc(breaksRef, firebaseBreakRecord);
    console.log('✅ Break saved to Firebase with ID:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error saving break to Firebase:', error);
    throw error;
  }
};

/**
 * Save leave request to Firebase
 */
export const saveLeaveToFirebase = async (leaveRecord) => {
  try {
    const leaveRef = collection(db, "leave_requests");
    
    const firebaseLeaveRecord = {
      ...leaveRecord,
      appliedDate: serverTimestamp(),
      createdAt: serverTimestamp(),
      employeeId: leaveRecord.empId,
      employeeName: leaveRecord.empName,
      fromDate: new Date(leaveRecord.fromDate),
      toDate: new Date(leaveRecord.toDate),
      status: 'Pending',
      reason: leaveRecord.reason,
    };
    
    const docRef = await addDoc(leaveRef, firebaseLeaveRecord);
    console.log('✅ Leave request saved to Firebase with ID:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error saving leave to Firebase:', error);
    throw error;
  }
};

/**
 * Save activity to Firebase
 */
export const saveActivityToFirebase = async (activityData) => {
  try {
    const activitiesRef = collection(db, 'activities');
    
    const firebaseActivity = {
      ...activityData,
      createdAt: serverTimestamp(),
      timestamp: serverTimestamp(),
      employeeId: activityData.employeeId || activityData.empId || 'unknown',
      employeeName: activityData.employeeName || activityData.empName || 'Unknown',
      action: activityData.action || 'ACTIVITY',
      type: activityData.type || 'info',
      message: activityData.message || '',
      breakType: activityData.breakType || null,
      exceededBy: activityData.exceededBy || null,
      workingHours: activityData.workingHours || null,
      totalBreaks: activityData.totalBreaks || null,
      reason: activityData.reason || null,
      recipient: activityData.recipient || null,
      subject: activityData.subject || null,
      browser: activityData.browser || navigator.userAgent.split(' ')[0] || 'Unknown',
      platform: activityData.platform || navigator.platform || 'Unknown'
    };
    
    const docRef = await addDoc(activitiesRef, firebaseActivity);
    console.log('✅ Activity saved to Firebase with ID:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('Error saving activity to Firebase:', error);
    throw error;
  }
};

// ==================== FETCH DATA FROM FIREBASE ====================

/**
 * Fetch ALL attendance data from Firebase (for Excel)
 */
export const fetchAllAttendanceData = async () => {
  try {
    const attendanceRef = collection(db, "attendance");
    const q = query(attendanceRef, orderBy("timestamp", "desc"));
    
    const querySnapshot = await getDocs(q);
    const data = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      const tsDate = docData.timestamp?.toDate?.() || null;
      // Convert Firebase Timestamps to regular dates
      data.push({
        id: doc.id,
        empId: docData.employeeId || docData.empId,
        empName: docData.employeeName || docData.empName,
        action: docData.action,
        timestamp: tsDate || new Date(),
        date: toLocalDateKey(tsDate) || docData.date || "",
        time: tsDate?.toLocaleTimeString('en-IN', { 
          hour: '2-digit', 
          minute: '2-digit',
          second: '2-digit',
          hour12: true 
        }) || docData.time || '',
        workingHours: docData.workingHours || '',
        totalBreaks: docData.totalBreaks || 0,
        shiftStartTimestamp: docData.shiftStartTimestamp?.toDate?.() || docData.shiftStartTime?.toDate?.() || null,
        shiftEndTimestamp: docData.shiftEndTimestamp?.toDate?.() || docData.shiftEndTime?.toDate?.() || null,
        durationMinutes: docData.durationMinutes || 0,
        shiftType: docData.shiftType || 'Regular'
      });
    });
    
    console.log(`✅ Fetched ${data.length} attendance records from Firebase`);
    return data;
  } catch (error) {
    console.error('❌ Error fetching attendance from Firebase:', error);
    return [];
  }
};

/**
 * Fetch attendance data from Firebase with filters
 */
export const fetchAttendanceFromFirebase = async (startDate = null, endDate = null) => {
  try {
    const attendanceRef = collection(db, "attendance");
    let q;
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      q = query(
        attendanceRef,
        where("timestamp", ">=", start),
        where("timestamp", "<=", end),
        orderBy("timestamp", "desc")
      );
    } else {
      q = query(attendanceRef, orderBy("timestamp", "desc"));
    }
    
    const querySnapshot = await getDocs(q);
    const data = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      const tsDate = docData.timestamp?.toDate?.() || null;
      data.push({
        id: doc.id,
        empId: docData.employeeId || docData.empId,
        empName: docData.employeeName || docData.empName,
        action: docData.action,
        timestamp: tsDate || new Date(),
        date: toLocalDateKey(tsDate) || docData.date || "",
        time: tsDate?.toLocaleTimeString() || docData.time || '',
        workingHours: docData.workingHours || '',
        totalBreaks: docData.totalBreaks || 0,
        shiftStartTimestamp: docData.shiftStartTime?.toDate?.() || null,
        shiftEndTimestamp: docData.shiftEndTime?.toDate?.() || null,
      });
    });
    
    console.log(`✅ Fetched ${data.length} attendance records from Firebase`);
    return data;
  } catch (error) {
    console.error('❌ Error fetching attendance from Firebase:', error);
    return [];
  }
};

/**
 * Fetch ALL break data from Firebase (for Excel)
 */
export const fetchAllBreaksData = async () => {
  try {
    const breaksRef = collection(db, "breaks");
    const q = query(breaksRef, orderBy("timestamp", "desc"));
    
    const querySnapshot = await getDocs(q);
    const data = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      const tsDate = docData.timestamp?.toDate?.() || null;
      data.push({
        id: doc.id,
        employeeId: docData.employeeId,
        employeeName: docData.employeeName,
        employee: docData.employeeName, // For compatibility
        breakType: docData.breakType,
        timestamp: tsDate || new Date(),
        exceededBy: docData.exceededBy || 0,
        allowedTime: docData.allowedTime || 0,
        status: docData.status || 'Completed',
        action: docData.action || '',
        message: docData.message || `Break ${docData.status || 'Completed'}`,
        type: docData.type || 'break',
        date: toLocalDateKey(tsDate) || docData.date || "",
        time: tsDate?.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }) || docData.time || '',
        startTime: docData.startTime || null
      });
    });
    
    console.log(`✅ Fetched ${data.length} break records from Firebase`);
    return data;
  } catch (error) {
    console.error('❌ Error fetching breaks from Firebase:', error);
    return [];
  }
};

/**
 * Fetch break history from Firebase
 */
export const fetchBreaksFromFirebase = async () => {
  try {
    const breaksRef = collection(db, "breaks");
    const q = query(breaksRef, orderBy("timestamp", "desc"));
    
    const querySnapshot = await getDocs(q);
    const data = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      data.push({
        id: doc.id,
        employeeId: docData.employeeId,
        employeeName: docData.employeeName,
        breakType: docData.breakType,
        timestamp: docData.timestamp?.toDate?.() || new Date(),
        exceededBy: docData.exceededBy || 0,
        allowedTime: docData.allowedTime || 0,
        status: docData.status,
        message: `Break ${docData.status}`,
      });
    });
    
    console.log(`✅ Fetched ${data.length} break records from Firebase`);
    return data;
  } catch (error) {
    console.error('❌ Error fetching breaks from Firebase:', error);
    return [];
  }
};

/**
 * Fetch ALL leave data from Firebase (for Excel)
 */
export const fetchAllLeavesData = async () => {
  try {
    const leaveRef = collection(db, "leave_requests");
    const q = query(leaveRef, orderBy("appliedDate", "desc"));
    
    const querySnapshot = await getDocs(q);
    const data = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      data.push({
        id: doc.id,
        empId: docData.employeeId,
        empName: docData.employeeName,
        employeeId: docData.employeeId,
        employeeName: docData.employeeName,
        fromDate: docData.fromDate?.toDate?.() || new Date(),
        toDate: docData.toDate?.toDate?.() || new Date(),
        reason: docData.reason || '',
        status: docData.status || 'Pending',
        appliedOn: docData.appliedDate?.toDate?.() || new Date(),
        employeeEmail: docData.employeeEmail || ''
      });
    });
    
    console.log(`✅ Fetched ${data.length} leave records from Firebase`);
    return data;
  } catch (error) {
    console.error('❌ Error fetching leaves from Firebase:', error);
    return [];
  }
};

/**
 * Fetch leave requests from Firebase
 */
export const fetchLeavesFromFirebase = async () => {
  try {
    const leaveRef = collection(db, "leave_requests");
    const q = query(leaveRef, orderBy("appliedDate", "desc"));
    
    const querySnapshot = await getDocs(q);
    const data = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      data.push({
        id: doc.id,
        empId: docData.employeeId,
        empName: docData.employeeName,
        fromDate: docData.fromDate?.toDate?.() || new Date(),
        toDate: docData.toDate?.toDate?.() || new Date(),
        reason: docData.reason || '',
        status: docData.status || 'Pending',
        appliedOn: docData.appliedDate?.toDate?.() || new Date(),
      });
    });
    
    console.log(`✅ Fetched ${data.length} leave records from Firebase`);
    return data;
  } catch (error) {
    console.error('❌ Error fetching leaves from Firebase:', error);
    return [];
  }
};

/**
 * Fetch ALL activities from Firebase
 */
export const fetchAllActivities = async () => {
  try {
    const activitiesRef = collection(db, 'activities');
    const q = query(activitiesRef, orderBy("timestamp", "desc"));
    
    const querySnapshot = await getDocs(q);
    const activities = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      activities.push({
        id: doc.id,
        ...docData,
        // Ensure timestamp is a Date object
        timestamp: docData.timestamp?.toDate?.() || new Date(),
        // Ensure consistent field names
        employeeId: docData.employeeId || docData.empId || 'unknown',
        employeeName: docData.employeeName || docData.empName || 'Unknown',
        action: docData.action || 'ACTIVITY',
        type: docData.type || 'info',
        message: docData.message || '',
        breakType: docData.breakType || null,
        exceededBy: docData.exceededBy || null,
        workingHours: docData.workingHours || null,
        totalBreaks: docData.totalBreaks || null,
        reason: docData.reason || null,
        recipient: docData.recipient || null,
        subject: docData.subject || null
      });
    });
    
    console.log(`✅ Fetched ${activities.length} activities from Firebase`);
    return activities;
  } catch (error) {
    console.error('Error fetching activities from Firebase:', error);
    return [];
  }
};

// ==================== COMPLETE DATA FETCH FOR EXCEL ====================

/**
 * Fetch ALL data from Firebase for Excel export
 */
export const fetchAllDataForExcel = async () => {
  try {
    const [attendance, breaks, leaves, activities] = await Promise.all([
      fetchAllAttendanceData(),
      fetchAllBreaksData(),
      fetchAllLeavesData(),
      fetchAllActivities()
    ]);
    
    console.log('✅ All data fetched from Firebase:', {
      attendance: attendance.length,
      breaks: breaks.length,
      leaves: leaves.length,
      activities: activities.length
    });
    
    return {
      attendance,
      breaks,
      leaves,
      activities
    };
  } catch (error) {
    console.error('❌ Error fetching all data from Firebase:', error);
    return {
      attendance: [],
      breaks: [],
      leaves: [],
      activities: []
    };
  }
};

/**
 * Fetch employee-specific data
 */
export const fetchEmployeeData = async (employeeId) => {
  try {
    const [attendance, breaks, leaves] = await Promise.all([
      fetchAttendanceByEmployee(employeeId),
      fetchBreaksByEmployee(employeeId),
      fetchLeavesByEmployee(employeeId)
    ]);
    
    return {
      attendance,
      breaks,
      leaves
    };
  } catch (error) {
    console.error('❌ Error fetching employee data:', error);
    return {
      attendance: [],
      breaks: [],
      leaves: []
    };
  }
};

/**
 * Fetch attendance by employee
 */
export const fetchAttendanceByEmployee = async (employeeId) => {
  try {
    const attendanceRef = collection(db, "attendance");
    const q = query(
      attendanceRef,
      where("employeeId", "==", employeeId),
      orderBy("timestamp", "desc")
    );
    
    const querySnapshot = await getDocs(q);
    const data = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      data.push({
        id: doc.id,
        ...docData,
        timestamp: docData.timestamp?.toDate?.() || new Date()
      });
    });
    
    return data;
  } catch (error) {
    console.error('❌ Error fetching employee attendance:', error);
    return [];
  }
};

/**
 * Fetch breaks by employee
 */
export const fetchBreaksByEmployee = async (employeeId) => {
  try {
    const breaksRef = collection(db, "breaks");
    const q = query(
      breaksRef,
      where("employeeId", "==", employeeId),
      orderBy("timestamp", "desc")
    );
    
    const querySnapshot = await getDocs(q);
    const data = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      data.push({
        id: doc.id,
        ...docData,
        timestamp: docData.timestamp?.toDate?.() || new Date()
      });
    });
    
    return data;
  } catch (error) {
    console.error('❌ Error fetching employee breaks:', error);
    return [];
  }
};

/**
 * Fetch leaves by employee
 */
export const fetchLeavesByEmployee = async (employeeId) => {
  try {
    const leaveRef = collection(db, "leave_requests");
    const q = query(
      leaveRef,
      where("employeeId", "==", employeeId),
      orderBy("appliedDate", "desc")
    );
    
    const querySnapshot = await getDocs(q);
    const data = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      data.push({
        id: doc.id,
        ...docData,
        appliedOn: docData.appliedDate?.toDate?.() || new Date()
      });
    });
    
    return data;
  } catch (error) {
    console.error('❌ Error fetching employee leaves:', error);
    return [];
  }
};

/**
 * Fetch today's data for dashboard
 */
export const fetchTodaysData = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const attendanceRef = collection(db, "attendance");
    const q = query(
      attendanceRef,
      where("timestamp", ">=", today),
      where("timestamp", "<", tomorrow),
      orderBy("timestamp", "desc")
    );
    
    const querySnapshot = await getDocs(q);
    const data = [];
    
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      data.push({
        id: doc.id,
        ...docData,
        timestamp: docData.timestamp?.toDate?.() || new Date()
      });
    });
    
    return data;
  } catch (error) {
    console.error('❌ Error fetching today\'s data:', error);
    return [];
  }
};
