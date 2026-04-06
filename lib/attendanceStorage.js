import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { db } from './firebase';
import { 
  collection, 
  addDoc, 
  serverTimestamp 
} from "firebase/firestore";

const EXCEL_FILE_PATH = path.join(process.cwd(), 'attendance_data.xlsx');
const INDIA_TIMEZONE = 'Asia/Kolkata';

const getIndiaDateAndTime = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${byType.year}-${byType.month}-${byType.day}`,
    time: `${byType.hour}:${byType.minute}`,
  };
};

// Initialize Excel file
const initializeExcel = () => {
  try {
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      const workbook = XLSX.utils.book_new();
      
      // Employees sheet
      const employeesSheet = XLSX.utils.json_to_sheet([
        { id: "NTS-001", name: "Prathamesh Shinde", shift: "10:00 AM - 7:00 PM" },
        { id: "NTS-002", name: "Adarsh Singh", shift: "10:00 AM - 7:00 PM" },
        { id: "NTS-003", name: "Payal Nalavade", shift: "10:00 AM - 7:00 PM" },
        { id: "NTS-004", name: "Vaishnavi GHODVINDE", shift: "10:00 AM - 7:00 PM" },
        { id: "NTS-005", name: "RUSHIKESH ANDHALE", shift: "10:00 AM - 7:00 PM" },
        { id: "NTS-006", name: "Upasana Patil", shift: "10:00 AM - 7:00 PM" },
        { id: "NTS-007", name: "Prajakta Dhande", shift: "10:00 AM - 7:00 PM" },
        { id: "NTS-008", name: "Chotelal Singh", shift: "10:00 AM - 7:00 PM" },
      ]);
      XLSX.utils.book_append_sheet(workbook, employeesSheet, 'Employees');
      
      // Attendance sheet
      const attendanceHeaders = [
        ['EmployeeID', 'EmployeeName', 'Date', 'LoginTime', 'LogoutTime', 
         'Status', 'Shift', 'IsLate', 'BreakDuration', 'NetHours']
      ];
      const attendanceSheet = XLSX.utils.aoa_to_sheet(attendanceHeaders);
      XLSX.utils.book_append_sheet(workbook, attendanceSheet, 'Attendance');
      
      // Breaks sheet
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
    console.error('❌ Error initializing Excel:', error);
  }
};

// Read data from Excel
export const readExcelData = (sheetName) => {
  try {
    initializeExcel();
    
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
    console.error(`Error reading ${sheetName}:`, error);
    return [];
  }
};

// Save to Excel
const saveToExcel = (sheetName, data) => {
  try {
    initializeExcel();
    
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
    
    const updatedData = [...existingData, data];
    const newWorksheet = XLSX.utils.json_to_sheet(updatedData);
    workbook.Sheets[sheetName] = newWorksheet;
    XLSX.writeFile(workbook, EXCEL_FILE_PATH);
    
    console.log(`✅ Saved to Excel (${sheetName})`);
    return true;
  } catch (error) {
    console.error(`Error saving to ${sheetName}:`, error);
    return false;
  }
};

// Save to Firebase
const saveToFirebase = async (collectionName, data) => {
  try {
    const collectionRef = collection(db, collectionName);
    const docRef = await addDoc(collectionRef, {
      ...data,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp()
    });
    
    console.log(`✅ Saved to Firebase (${collectionName}) ID:`, docRef.id);
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error(`Error saving to Firebase (${collectionName}):`, error);
    return { success: false, error };
  }
};

// Main function to save attendance (both Excel and Firebase)
export const saveAttendance = async (attendanceData) => {
  const { date: today, time: currentTime } = getIndiaDateAndTime();

  // Excel data format
  const excelData = {
    EmployeeID: attendanceData.employeeId,
    EmployeeName: attendanceData.employeeName,
    Date: today,
    LoginTime: attendanceData.action === 'clock-in' ? currentTime : '',
    LogoutTime: attendanceData.action === 'clock-out' ? currentTime : '',
    Status: attendanceData.action === 'clock-in' ? 'Present' : 'Completed',
    Shift: attendanceData.shift || '10:00 AM - 7:00 PM',
    IsLate: attendanceData.isLate || false,
    BreakDuration: '00:00',
    NetHours: ''
  };

  // Firebase data format
  const firebaseData = {
    employeeId: attendanceData.employeeId,
    employeeName: attendanceData.employeeName,
    action: attendanceData.action,
    date: today,
    time: currentTime,
    shift: attendanceData.shift || '10:00 AM - 7:00 PM',
    isLate: attendanceData.isLate || false,
    status: attendanceData.action === 'clock-in' ? 'Present' : 'Completed'
  };

  try {
    // Save to Excel
    const excelResult = saveToExcel('Attendance', excelData);
    
    // Save to Firebase
    const firebaseResult = await saveToFirebase('attendance', firebaseData);
    
    return {
      success: excelResult || firebaseResult.success,
      excel: excelResult,
      firebase: firebaseResult.success,
      timestamp: currentTime
    };
  } catch (error) {
    console.error('Error saving attendance:', error);
    return { success: false, excel: false, firebase: false };
  }
};

// Main function to save break (both Excel and Firebase)
export const saveBreak = async (breakData) => {
  const { date: today, time: currentTime } = getIndiaDateAndTime();

  // Excel data format
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

  // Firebase data format
  const firebaseData = {
    employeeId: breakData.employeeId,
    employeeName: breakData.employeeName,
    breakType: breakData.breakType,
    action: breakData.action,
    date: today,
    time: currentTime,
    status: breakData.action === 'start' ? 'Active' : 'Completed'
  };

  try {
    // Save to Excel
    const excelResult = saveToExcel('Breaks', excelData);
    
    // Save to Firebase
    const firebaseResult = await saveToFirebase('breaks', firebaseData);
    
    return {
      success: excelResult || firebaseResult.success,
      excel: excelResult,
      firebase: firebaseResult.success,
      timestamp: currentTime
    };
  } catch (error) {
    console.error('Error saving break:', error);
    return { success: false, excel: false, firebase: false };
  }
};

// Get today's attendance
export const getTodaysAttendance = () => {
  const { date: today } = getIndiaDateAndTime();
  const allAttendance = readExcelData('Attendance');
  return allAttendance.filter(record => record.Date === today);
};

// Get employee breaks
export const getEmployeeBreaks = (employeeId) => {
  const { date: today } = getIndiaDateAndTime();
  const allBreaks = readExcelData('Breaks');
  return allBreaks.filter(record => 
    record.EmployeeID === employeeId && record.Date === today
  );
};
