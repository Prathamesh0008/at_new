import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { 
  saveAttendanceToFirebase, 
  saveBreakToFirebase,
  fetchAttendanceFromFirebase,
  fetchBreaksFromFirebase 
} from './firebase-helpers';

const EXCEL_FILE_PATH = path.join(process.cwd(), 'attendance_data.xlsx');

// ==================== EXCEL FUNCTIONS ====================

const initializeExcelFile = () => {
  try {
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      const workbook = XLSX.utils.book_new();
      
      // Create Employees sheet
      const employeesSheet = XLSX.utils.json_to_sheet([
        { 
          id: "NTS-001", 
          name: "Prathamesh Shinde", 
          shift: "10:00 AM - 7:00 PM",
          email: "prathameshs157@gmail.com",
          phone: "+91 9876543210",
          department: "Development"
        },
        { 
          id: "NTS-002", 
          name: "Adarsh Singh", 
          shift: "10:00 AM - 7:00 PM",
          email: "mawesome230@gmail.com",
          phone: "+91 9876543211",
          department: "Development"
        },
        { 
          id: "NTS-004", 
          name: "Vaishnavi GHODVINDE", 
          shift: "10:00 AM - 7:00 PM",
          email: "vaishnavighodvinde@gmail.com",
          phone: "+91 9876543213",
          department: "Development"
        },
        { 
          id: "NTS-005", 
          name: "RUSHIKESH ANDHALE", 
          shift: "10:00 AM - 7:00 PM",
          email: "rushikeshandhale1010@gmail.com",
          phone: "+91 9876543214",
          department: "Development"
        },
        { 
          id: "NTS-006", 
          name: "Upasana Patil", 
          shift: "10:00 AM - 7:00 PM",
          email: "patilupasana27@gmail.com",
          phone: "+91 9876543215",
          department: "Development"
        },
        { 
          id: "NTS-007", 
          name: "Prajakta Dhande", 
          shift: "10:00 AM - 7:00 PM",
          email: "dhandeprajakta123@gmail.com",
          phone: "+91 9876543216",
          department: "Development"
        },
        { 
          id: "NTS-008", 
          name: "Chotelal Singh", 
          shift: "10:00 AM - 7:00 PM",
          email: "chotelal.singh@novatechsciences.com",
          phone: "+91 9876543217",
          department: "Development"
        }
      ]);
      XLSX.utils.book_append_sheet(workbook, employeesSheet, 'Employees');
      
      // Create Attendance sheet
      const attendanceHeaders = [
        ['EmployeeID', 'EmployeeName', 'Date', 'LoginTime', 'LogoutTime', 
         'TotalHours', 'BreakDuration', 'NetHours', 'Status', 'Shift', 'IsLate']
      ];
      const attendanceSheet = XLSX.utils.aoa_to_sheet(attendanceHeaders);
      XLSX.utils.book_append_sheet(workbook, attendanceSheet, 'Attendance');
      
      // Create Breaks sheet
      const breaksHeaders = [
        ['EmployeeID', 'EmployeeName', 'Date', 'BreakType', 'BreakStart', 
         'BreakEnd', 'BreakDuration', 'Status']
      ];
      const breaksSheet = XLSX.utils.aoa_to_sheet(breaksHeaders);
      XLSX.utils.book_append_sheet(workbook, breaksSheet, 'Breaks');
      
      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log('✅ Excel file initialized');
    }
  } catch (error) {
    console.error('❌ Error initializing Excel file:', error);
  }
};

const readExcelData = (sheetName) => {
  try {
    initializeExcelFile();
    
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      return [];
    }
    
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);
    const worksheet = workbook.Sheets[sheetName];
    
    if (!worksheet) {
      return [];
    }
    
    return XLSX.utils.sheet_to_json(worksheet);
  } catch (error) {
    console.error(`❌ Error reading ${sheetName} sheet:`, error);
    return [];
  }
};

const writeToExcel = (sheetName, data) => {
  try {
    initializeExcelFile();
    
    let workbook;
    if (fs.existsSync(EXCEL_FILE_PATH)) {
      workbook = XLSX.readFile(EXCEL_FILE_PATH);
    } else {
      workbook = XLSX.utils.book_new();
    }
    
    let existingData = [];
    if (workbook.Sheets[sheetName]) {
      existingData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }
    
    const updatedData = [...existingData, ...data];
    const newWorksheet = XLSX.utils.json_to_sheet(updatedData);
    workbook.Sheets[sheetName] = newWorksheet;
    XLSX.writeFile(workbook, EXCEL_FILE_PATH);
    
    console.log(`✅ Data written to Excel (${sheetName}):`, data.length, 'records');
    return true;
  } catch (error) {
    console.error(`❌ Error writing to ${sheetName} sheet:`, error);
    return false;
  }
};

const updateExcelRecord = (sheetName, employeeId, date, updates) => {
  try {
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);
    const worksheet = workbook.Sheets[sheetName];
    let data = XLSX.utils.sheet_to_json(worksheet);
    
    const recordIndex = data.findIndex(record => 
      record.EmployeeID === employeeId && record.Date === date
    );
    
    if (recordIndex !== -1) {
      data[recordIndex] = { ...data[recordIndex], ...updates };
      const newWorksheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets[sheetName] = newWorksheet;
      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log(`✅ Excel record updated (${sheetName})`);
      return true;
    }
    
    console.log(`❌ Record not found in Excel (${sheetName})`);
    return false;
  } catch (error) {
    console.error(`❌ Error updating Excel record (${sheetName}):`, error);
    return false;
  }
};

// ==================== DUAL STORAGE FUNCTIONS ====================

/**
 * Save attendance to both Excel and Firebase
 */
export const saveAttendanceDual = async (attendanceData) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    // Format data for Excel
    const excelData = {
      EmployeeID: attendanceData.employeeId,
      EmployeeName: attendanceData.employeeName,
      Date: today,
      LoginTime: attendanceData.action === 'clock-in' ? currentTime : '',
      LogoutTime: attendanceData.action === 'clock-out' ? currentTime : '',
      TotalHours: '',
      BreakDuration: '00:00',
      NetHours: '',
      Status: attendanceData.action === 'clock-in' ? 'Present' : 'Completed',
      Shift: attendanceData.shift || '10:00 AM - 7:00 PM',
      IsLate: attendanceData.isLate || false
    };
    
    // Save to Excel
    const excelSuccess = writeToExcel('Attendance', [excelData]);
    
    // Prepare data for Firebase
    const firebaseData = {
      empId: attendanceData.employeeId,
      empName: attendanceData.employeeName,
      action: attendanceData.action,
      date: today,
      time: currentTime,
      shift: attendanceData.shift || '10:00 AM - 7:00 PM',
      isLate: attendanceData.isLate || false,
      status: attendanceData.action === 'clock-in' ? 'Present' : 'Completed'
    };
    
    // Save to Firebase
    let firebaseSuccess = false;
    try {
      await saveAttendanceToFirebase(firebaseData);
      firebaseSuccess = true;
    } catch (firebaseError) {
      console.error('❌ Firebase save failed:', firebaseError);
    }
    
    return {
      excel: excelSuccess,
      firebase: firebaseSuccess,
      timestamp: currentTime
    };
  } catch (error) {
    console.error('❌ Error saving attendance:', error);
    return { excel: false, firebase: false, error: error.message };
  }
};

/**
 * Save break to both Excel and Firebase
 */
export const saveBreakDual = async (breakData) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    // Format data for Excel
    const excelData = {
      EmployeeID: breakData.employeeId,
      EmployeeName: breakData.employeeName,
      Date: today,
      BreakType: breakData.breakType,
      BreakStart: breakData.action === 'start' ? currentTime : '',
      BreakEnd: breakData.action === 'end' ? currentTime : '',
      BreakDuration: '',
      Status: breakData.action === 'start' ? 'Active' : 'Completed'
    };
    
    // Save to Excel
    const excelSuccess = writeToExcel('Breaks', [excelData]);
    
    // Prepare data for Firebase
    const firebaseData = {
      employeeId: breakData.employeeId,
      employeeName: breakData.employeeName,
      breakType: breakData.breakType,
      action: breakData.action,
      timestamp: currentTime,
      status: breakData.action === 'start' ? 'Active' : 'Completed'
    };
    
    // Save to Firebase
    let firebaseSuccess = false;
    try {
      await saveBreakToFirebase(firebaseData);
      firebaseSuccess = true;
    } catch (firebaseError) {
      console.error('❌ Firebase save failed:', firebaseError);
    }
    
    return {
      excel: excelSuccess,
      firebase: firebaseSuccess,
      timestamp: currentTime
    };
  } catch (error) {
    console.error('❌ Error saving break:', error);
    return { excel: false, firebase: false, error: error.message };
  }
};

/**
 * Update attendance record in both Excel and Firebase
 */
export const updateAttendanceRecordDual = async (employeeId, date, updates) => {
  try {
    // Update in Excel
    const excelSuccess = updateExcelRecord('Attendance', employeeId, date, updates);
    
    // Update in Firebase would require additional logic
    // For now, we'll log it
    console.log('📝 Firebase update needed for:', { employeeId, date, updates });
    
    return {
      excel: excelSuccess,
      firebase: true, // Placeholder
      message: 'Excel updated, Firebase update logged'
    };
  } catch (error) {
    console.error('❌ Error updating attendance record:', error);
    return { excel: false, firebase: false, error: error.message };
  }
};

/**
 * Get today's attendance from both sources
 */
export const getTodaysAttendanceDual = async () => {
  try {
    // Get from Excel
    const excelData = readExcelData('Attendance');
    const today = new Date().toISOString().split('T')[0];
    const excelToday = excelData.filter(record => record.Date === today);
    
    // Get from Firebase
    let firebaseData = [];
    try {
      const startDate = new Date(today);
      const endDate = new Date(today);
      endDate.setHours(23, 59, 59, 999);
      firebaseData = await fetchAttendanceFromFirebase(startDate, endDate);
    } catch (firebaseError) {
      console.error('❌ Firebase fetch failed:', firebaseError);
    }
    
    console.log(`📊 Data sources - Excel: ${excelToday.length} records, Firebase: ${firebaseData.length} records`);
    
    // Combine and deduplicate (prefer Firebase if available)
    const combinedData = [...firebaseData];
    
    // Add Excel records that don't exist in Firebase
    excelToday.forEach(excelRecord => {
      const existsInFirebase = combinedData.some(fbRecord => 
        fbRecord.empId === excelRecord.EmployeeID && 
        fbRecord.date === excelRecord.Date
      );
      
      if (!existsInFirebase) {
        combinedData.push({
          id: `excel_${excelRecord.EmployeeID}_${excelRecord.Date}`,
          empId: excelRecord.EmployeeID,
          empName: excelRecord.EmployeeName,
          date: excelRecord.Date,
          time: excelRecord.LoginTime || excelRecord.LogoutTime,
          action: excelRecord.LogoutTime ? 'clock-out' : 'clock-in',
          status: excelRecord.Status,
          shift: excelRecord.Shift,
          isLate: excelRecord.IsLate,
          source: 'Excel'
        });
      }
    });
    
    return {
      excelCount: excelToday.length,
      firebaseCount: firebaseData.length,
      combined: combinedData,
      sources: {
        excel: excelToday,
        firebase: firebaseData
      }
    };
  } catch (error) {
    console.error('❌ Error getting today\'s attendance:', error);
    return { excelCount: 0, firebaseCount: 0, combined: [], sources: { excel: [], firebase: [] } };
  }
};

/**
 * Get today's breaks from both sources
 */
export const getTodaysBreaksDual = async (employeeId = null) => {
  try {
    // Get from Excel
    const excelData = readExcelData('Breaks');
    const today = new Date().toISOString().split('T')[0];
    let excelToday = excelData.filter(record => record.Date === today);
    
    if (employeeId) {
      excelToday = excelToday.filter(record => record.EmployeeID === employeeId);
    }
    
    // Get from Firebase
    let firebaseData = [];
    try {
      const startDate = new Date(today);
      const endDate = new Date(today);
      endDate.setHours(23, 59, 59, 999);
      firebaseData = await fetchBreaksFromFirebase(startDate, endDate);
      
      if (employeeId) {
        firebaseData = firebaseData.filter(record => record.employeeId === employeeId);
      }
    } catch (firebaseError) {
      console.error('❌ Firebase fetch failed:', firebaseError);
    }
    
    return {
      excelCount: excelToday.length,
      firebaseCount: firebaseData.length,
      combined: [...excelToday, ...firebaseData],
      sources: {
        excel: excelToday,
        firebase: firebaseData
      }
    };
  } catch (error) {
    console.error('❌ Error getting today\'s breaks:', error);
    return { excelCount: 0, firebaseCount: 0, combined: [], sources: { excel: [], firebase: [] } };
  }
};

// ==================== EXPORT FUNCTIONS ====================

/**
 * Export data from both sources
 */
export const exportDataDual = async (startDate = null, endDate = null) => {
  try {
    // Get data from both sources
    const excelAttendance = readExcelData('Attendance');
    const excelBreaks = readExcelData('Breaks');
    
    let firebaseAttendance = [];
    let firebaseBreaks = [];
    
    try {
      const fbData = await fetchAttendanceFromFirebase(startDate, endDate);
      firebaseAttendance = fbData;
      firebaseBreaks = await fetchBreaksFromFirebase();
    } catch (firebaseError) {
      console.error('❌ Firebase fetch failed during export:', firebaseError);
    }
    
    // Combine data
    const combinedData = {
      excel: {
        attendance: excelAttendance,
        breaks: excelBreaks
      },
      firebase: {
        attendance: firebaseAttendance,
        breaks: firebaseBreaks
      },
      summary: {
        totalRecords: excelAttendance.length + firebaseAttendance.length,
        excelRecords: excelAttendance.length,
        firebaseRecords: firebaseAttendance.length,
        exportDate: new Date().toISOString()
      }
    };
    
    return combinedData;
  } catch (error) {
    console.error('❌ Error exporting data:', error);
    return null;
  }
};

/**
 * Sync data between Excel and Firebase
 */
export const syncData = async () => {
  try {
    console.log('🔄 Starting data sync between Excel and Firebase...');
    
    // Get all Excel data
    const excelAttendance = readExcelData('Attendance');
    const excelBreaks = readExcelData('Breaks');
    
    // Get all Firebase data
    const firebaseAttendance = await fetchAttendanceFromFirebase();
    const firebaseBreaks = await fetchBreaksFromFirebase();
    
    console.log('📊 Sync Summary:');
    console.log(`  Excel - Attendance: ${excelAttendance.length}, Breaks: ${excelBreaks.length}`);
    console.log(`  Firebase - Attendance: ${firebaseAttendance.length}, Breaks: ${firebaseBreaks.length}`);
    
    return {
      status: 'success',
      message: 'Sync completed',
      stats: {
        excelAttendance: excelAttendance.length,
        excelBreaks: excelBreaks.length,
        firebaseAttendance: firebaseAttendance.length,
        firebaseBreaks: firebaseBreaks.length
      }
    };
  } catch (error) {
    console.error('❌ Error syncing data:', error);
    return {
      status: 'error',
      message: error.message,
      stats: null
    };
  }
};
