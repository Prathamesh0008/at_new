'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Coffee,
  Sandwich,
  Moon,
  Wind,
  CalendarDays,
  Download,
  Play,
  StopCircle,
  Bell,
  Mail,
  AlertCircle,
  X,
  Send,
  CheckCircle,
  Clock,
  Users,
  LogOut,
  User,
  FileText,
  Activity,
  Shield,
  UserCircle,
  AtSign,
  Smartphone,
  History,
  LogIn,
  LogOut as LogOutIcon,
  Coffee as CoffeeIcon,
  Calendar
} from 'lucide-react';
import * as XLSX from 'xlsx';
// Add these imports at the top of your page.jsx file
import { 
  saveAttendanceToFirebase, 
  saveBreakToFirebase, 
  saveLeaveToFirebase,
  fetchAllDataForExcel 
} from '@/lib/firebase-helpers';

// Email function
const sendRealEmail = async (to, subject, htmlContent, emailType = null, emailData = null) => {
  try {
    console.log('Sending email to:', to, 'Subject:', subject, 'Type:', emailType);
    
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to,
        subject,
        htmlContent,
        emailType,
        emailData,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to send email');
    }
    
    const result = await response.json();
    console.log('Email API response:', result);
    
    if (result.simulated) {
      console.log('⚠️ Email simulated');
      return { 
        success: true, 
        simulated: true,
        message: result.message
      };
    }
    
    return result;
    
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};
const debugLocalStorage = () => {
  const shift = getShiftFromStorage();
  const activeBreak = getActiveBreakFromStorage();
  
  console.log('=== LOCAL STORAGE DEBUG ===');
  console.log('Shift:', shift);
  console.log('Active Break:', activeBreak);
  console.log('===========================');
  
  alert(`Local Storage Debug:\n\nShift: ${shift ? JSON.stringify(shift, null, 2) : 'None'}\n\nActive Break: ${activeBreak ? JSON.stringify(activeBreak, null, 2) : 'None'}`);
};
// Helper functions for localStorage
const saveShiftToStorage = (shiftData) => {
  localStorage.setItem('currentShift', JSON.stringify(shiftData));
  // Add to your existing localStorage helpers

};

const getShiftFromStorage = () => {
  const data = localStorage.getItem('currentShift');
  return data ? JSON.parse(data) : null;
};

const clearShiftFromStorage = () => {
  localStorage.removeItem('currentShift');
};
// Active break storage helpers
const saveActiveBreakToStorage = (breakData) => {
  localStorage.setItem('activeBreak', JSON.stringify(breakData));
};

const getActiveBreakFromStorage = () => {
  const data = localStorage.getItem('activeBreak');
  return data ? JSON.parse(data) : null;
};

const clearActiveBreakFromStorage = () => {
  localStorage.removeItem('activeBreak');
};

// Sound notification
const playNotificationSound = () => {
  try {
    const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-alarm-digital-clock-beep-989.mp3');
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch (error) {
    console.log('Sound notification failed');
  }
};

// Modal Component - Dark Theme
const Modal = ({ isOpen, onClose, children, title }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-70" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md">
          <div className="p-6">
            {title && (
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-700">
                <h3 className="text-xl font-bold text-white">{title}</h3>
                <button 
                  onClick={onClose} 
                  className="text-gray-400 hover:text-white p-1 hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};


// TimerBar Component - Dark Theme
// TimerBar Component - Dark Theme (UPDATED for break continuation)
const TimerBar = ({ totalSeconds, breakType, onComplete, onExceed, elapsedSeconds = 0 }) => {
  const [secondsElapsed, setSecondsElapsed] = useState(elapsedSeconds);
  const [isExceeded, setIsExceeded] = useState(false);

  useEffect(() => {
    // If we already exceeded before refresh, trigger exceeded state immediately
    if (secondsElapsed > totalSeconds && !isExceeded) {
      setIsExceeded(true);
      onExceed?.(secondsElapsed - totalSeconds);
      return;
    }

    // If break is already complete
    if (secondsElapsed >= totalSeconds) {
      onComplete?.();
      return;
    }

    const timer = setInterval(() => {
      setSecondsElapsed(prev => {
        const newElapsed = prev + 1;
        
        if (newElapsed > totalSeconds && !isExceeded) {
          setIsExceeded(true);
          onExceed?.(newElapsed - totalSeconds);
        }
        
        if (newElapsed >= totalSeconds) {
          onComplete?.();
        }
        
        return newElapsed;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsElapsed, totalSeconds, onComplete, onExceed, isExceeded]);

  const secondsLeft = Math.max(0, totalSeconds - secondsElapsed);
  const progress = Math.min(100, (secondsElapsed / totalSeconds) * 100);
  const minutes = Math.floor(Math.abs(secondsLeft) / 60);
  const seconds = Math.abs(secondsLeft) % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-semibold text-gray-300">{breakType} Break</span>
          {elapsedSeconds > 0 && (
            <span className="text-xs bg-amber-900/50 text-amber-300 px-2 py-0.5 rounded-full">
              RESUMED
            </span>
          )}
        </div>
        <div className={`text-sm font-mono font-bold ${isExceeded ? 'text-red-400' : 'text-emerald-400'}`}>
          {isExceeded ? '⏰ EXCEEDED' : '⏱️ Remaining'}: {minutes}:{seconds.toString().padStart(2, '0')}
        </div>
      </div>
      
      <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            isExceeded 
              ? 'bg-gradient-to-r from-red-500 to-red-600' 
              : progress > 80 
                ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                : 'bg-gradient-to-r from-emerald-500 to-teal-500'
          }`}
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>
      
      <div className="flex justify-between text-xs text-gray-500">
        <span>
          Elapsed: {Math.floor(secondsElapsed / 60)}:{String(secondsElapsed % 60).padStart(2, '0')}
        </span>
        <span>
          Total: {totalMinutes}:{String(totalSeconds % 60).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
};
// Employee data WITH EMAILS
const employees = [
  { 
    id: "NTS-001", 
    name: "Prathamesh Shinde", 
    shift: "10:00 AM - 7:00 PM",
    email: "prathameshs157@gmail.com",
    phone: "+91 9876543210"
  },
  { 
    id: "NTS-002", 
    name: "Adarsh Singh", 
    shift: "10:00 AM - 7:00 PM",
    email: "mawesome230@gmail.com",
    phone: "+91 9876543211"
  },
  { 
    id: "NTS-003", 
    name: "Payal Nalavade", 
    shift: "9:00 AM - 6:00 PM",
    email: "Payalnalwade73@gmail.com",
    phone: "+91 9876543212"
  },
  { 
    id: "NTS-004", 
    name: "Vaishnavi GHODVINDE", 
    shift: "9:00 AM - 6:00 PM",
    email: "vaishnavighodvinde@gmail.com",
    phone: "+91 9876543213"
  },
  { 
    id: "NTS-005", 
    name: "RUSHIKESH ANDHALE", 
    shift: "9:00 AM - 6:00 PM",
    email: "rushikeshandhale1010@gmail.com",
    phone: "+91 9876543214"
  },
  { 
    id: "NTS-006", 
    name: "Upasana Patil", 
    shift: "9:00 AM - 6:00 PM",
    email: "patilupasana27@gmail.com",
    phone: "+91 9876543215"
  },
  { 
    id: "NTS-007", 
    name: "Prajakta Dhande", 
    shift: "9:00 AM - 6:00 PM",
    email: "dhandeprajakta123@gmail.com",
    phone: "+91 9876543216"
  },
  { 
    id: "NTS-008", 
    name: "Chotelal Singh", 
    shift: "9:00 AM - 6:00 PM",
    email: "chotelal.singh@novatechsciences.com",
    phone: "+91 9876543217"
  },
];

// Manager configuration
const MANAGER = {
  name: "Prathamesh Shinde",
  email: "sprathamesh581@gmail.com",
  phone: "+91 9876543210"
};

const BREAK_LIMITS = {
  Tea: 15,
  Lunch: 30,
  Evening: 15,
  Breather: 5
};

// Add to activityIcons mapping
const activityIcons = {
  'SHIFT_START': LogIn,
  'SHIFT_END': LogOutIcon,
  'SHIFT_RESTORED': CheckCircle, // Add this
  'BREAK_START': CoffeeIcon,
  'BREAK_END': CoffeeIcon,
  'BREAK_COMPLETED': CoffeeIcon,
  'BREAK_EXCEEDED': AlertCircle,
  'BREAK_RESTORED': CoffeeIcon, // Add this
  'LEAVE_APPLIED': Calendar,
  'LEAVE_APPROVED': CheckCircle,
  'LEAVE_REJECTED': X,
  'EMAIL_SENT': Mail,
  'DAILY_SUMMARY': Send
};

// Add to activityColors
const activityColors = {
  'SHIFT_START': 'text-green-400',
  'SHIFT_END': 'text-blue-400',
  'SHIFT_RESTORED': 'text-cyan-400', // Add this
  'BREAK_START': 'text-amber-400',
  'BREAK_END': 'text-amber-400',
  'BREAK_COMPLETED': 'text-emerald-400',
  'BREAK_EXCEEDED': 'text-red-400',
  'BREAK_RESTORED': 'text-amber-400', // Add this
  'LEAVE_APPLIED': 'text-purple-400',
  'LEAVE_APPROVED': 'text-green-400',
  'LEAVE_REJECTED': 'text-red-400',
  'EMAIL_SENT': 'text-indigo-400',
  'DAILY_SUMMARY': 'text-cyan-400'
};

// Add to activityBgColors
const activityBgColors = {
  'SHIFT_START': 'bg-green-900/20 border-green-800/30',
  'SHIFT_END': 'bg-blue-900/20 border-blue-800/30',
  'SHIFT_RESTORED': 'bg-cyan-900/20 border-cyan-800/30', // Add this
  'BREAK_START': 'bg-amber-900/20 border-amber-800/30',
  'BREAK_END': 'bg-amber-900/20 border-amber-800/30',
  'BREAK_COMPLETED': 'bg-emerald-900/20 border-emerald-800/30',
  'BREAK_EXCEEDED': 'bg-red-900/20 border-red-800/30',
  'BREAK_RESTORED': 'bg-amber-900/20 border-amber-800/30', // Add this
  'LEAVE_APPLIED': 'bg-purple-900/20 border-purple-800/30',
  'LEAVE_APPROVED': 'bg-green-900/20 border-green-800/30',
  'LEAVE_REJECTED': 'bg-red-900/20 border-red-800/30',
  'EMAIL_SENT': 'bg-indigo-900/20 border-indigo-800/30',
  'DAILY_SUMMARY': 'bg-cyan-900/20 border-cyan-800/30'
};

const ADMIN_PASSWORD = "Sky@2204";

export default function HomePage() {
  const [empId, setEmpId] = useState("");
  const [empName, setEmpName] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [empPhone, setEmpPhone] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [shiftStarted, setShiftStarted] = useState(false);
  const [shiftStartTime, setShiftStartTime] = useState(null);
  const [activeBreak, setActiveBreak] = useState(null);
  const [totalBreakTime, setTotalBreakTime] = useState(0);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveData, setLeaveData] = useState({ from: '', to: '', reason: '' });
  const [alerts, setAlerts] = useState([]);
  const [activityHistory, setActivityHistory] = useState([]);
  const [attendanceData, setAttendanceData] = useState([]);
  const [leaveDataLocal, setLeaveDataLocal] = useState([]);
  const [breakHistory, setBreakHistory] = useState([]);
  const [showBreakOverModal, setShowBreakOverModal] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showActivityHistory, setShowActivityHistory] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState({
    shiftStart: true,
    shiftEnd: true,
    breakExceeded: true,
    leaveApplied: true,
    dailySummary: true
  });

  const currentEmployee = useMemo(
    () => employees.find((e) => e.id === empId) || null,
    [empId]
  );

  // Add activity to history
  const addActivity = (activity) => {
    const newActivity = {
      id: Date.now(),
      timestamp: new Date(),
      employeeId: empId,
      employeeName: empName,
      ...activity
    };
    
    setActivityHistory(prev => [newActivity, ...prev.slice(0, 49)]);
    
    // Also add to alerts for immediate notification
    const alertActivity = {
      id: Date.now(),
      type: activity.type || 'info',
      message: activity.message,
      timestamp: new Date(),
      ...activity
    };
    
    setAlerts(prev => [alertActivity, ...prev.slice(0, 9)]);
  };

  // Handle break time exceeded
  const handleBreakExceeded = async (breakType, exceededSeconds) => {
  // Calculate total elapsed time
  let elapsedMinutes;
  if (activeBreak?.elapsedSeconds) {
    // Use the already elapsed time plus exceeded seconds
    elapsedMinutes = Math.ceil((activeBreak.elapsedSeconds + exceededSeconds) / 60);
  } else {
    // Fallback to old calculation
    elapsedMinutes = Math.ceil(exceededSeconds / 60);
  }
  
  const allowedMinutes = BREAK_LIMITS[breakType];
  const actualMinutes = elapsedMinutes;
  
  // Rest of the function remains the same...
  playNotificationSound();
  
  // Add to activity history
  addActivity({
    action: 'BREAK_EXCEEDED',
    breakType,
    exceededBy: Math.max(0, actualMinutes - allowedMinutes),
    allowedTime: allowedMinutes,
    actualTime: actualMinutes,
    message: `${breakType} break exceeded by ${Math.max(0, actualMinutes - allowedMinutes)} minute(s)!`,
    type: 'warning'
  });
    setShowBreakOverModal(true);
    
    // Save break data to Firebase
    const breakRecord = {
      id: Date.now(),
      type: 'warning',
      message: `${breakType} break exceeded by ${exceededMinutes} minute(s)!`,
      timestamp: new Date(),
      breakType,
      exceededBy: exceededMinutes,
      employee: empName,
      employeeId: empId,
      employeeName: empName,
      allowedTime: allowedMinutes,
      actualTime: actualMinutes,
      status: 'exceeded',
      date: new Date().toLocaleDateString('en-IN'),
      time: new Date().toLocaleTimeString('en-IN', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: true 
      }),
    };
    
    setBreakHistory(prev => [...prev, breakRecord]);
    
    try {
      await saveBreakToFirebase(breakRecord);
      console.log('✅ Break exceeded record saved to Firebase');
    } catch (error) {
      console.error('❌ Failed to save break to Firebase:', error);
    }
    
    // Email notifications based on settings
    setEmailStatus('Sending notifications...');
    
    try {
      // Send to MANAGER
      if (notificationSettings.breakExceeded) {
        const managerEmailResult = await sendRealEmail(
          MANAGER.email, 
          `⏰ BREAK ALERT: ${empName} exceeded ${breakType} break`,
          '',
          'breakExceeded',
          {
            employeeName: empName,
            employeeId: empId,
            breakType: breakType,
            exceededBy: exceededMinutes,
            allowedMinutes: allowedMinutes,
            actualMinutes: actualMinutes,
            time: new Date().toLocaleString(),
          }
        );
        
        // Add email activity
        addActivity({
          action: 'EMAIL_SENT',
          recipient: MANAGER.email,
          subject: `Break Alert: ${empName}`,
          message: `Break exceeded email sent to manager`,
          type: 'info'
        });
      }
      
      // Send to EMPLOYEE
      if (notificationSettings.breakExceeded && empEmail) {
        const employeeEmailResult = await sendRealEmail(
          empEmail,
          `⚠️ Break Time Exceeded - ${empName}`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
              <h2 style="color: #dc2626; text-align: center;">Break Time Exceeded Notification</h2>
              <div style="background-color: #fef2f2; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Employee:</strong> ${empName} (${empId})</p>
                <p><strong>Break Type:</strong> ${breakType}</p>
                <p><strong>Exceeded By:</strong> ${exceededMinutes} minutes</p>
                <p><strong>Allowed Time:</strong> ${allowedMinutes} minutes</p>
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              </div>
              <p style="color: #666; font-size: 14px;">Please be mindful of break timings in the future.</p>
              <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
              <p style="text-align: center; color: #999; font-size: 12px;">
                Nova TechSciences Attendance Portal<br>
                This is an automated notification
              </p>
            </div>
          `,
          null,
          {
            employeeName: empName,
            employeeId: empId,
            breakType: breakType,
            exceededBy: exceededMinutes,
            allowedMinutes: allowedMinutes,
            actualMinutes: actualMinutes,
          }
        );
        
        // Add email activity
        addActivity({
          action: 'EMAIL_SENT',
          recipient: empEmail,
          subject: `Break Exceeded Alert`,
          message: `Break exceeded notification sent to employee`,
          type: 'info'
        });
      }
      
      setEmailStatus('✅ Notifications sent successfully!');
      
    } catch (error) {
      console.error('Error sending emails:', error);
      setEmailStatus('❌ Failed to send some notifications');
    }
  };

  const handleBreakComplete = async (breakType, actualMinutes) => {
    // Add to activity history
    addActivity({
      action: 'BREAK_COMPLETED',
      breakType,
      actualTime: actualMinutes,
      allowedTime: BREAK_LIMITS[breakType],
      message: `${breakType} break completed in ${actualMinutes} minute(s)`,
      type: 'success'
    });
    
    // Save completed break to Firebase
    const breakRecord = {
      id: Date.now(),
      type: 'success',
      message: `${breakType} break completed in ${actualMinutes} minute(s)`,
      timestamp: new Date(),
      breakType,
      employee: empName,
      employeeId: empId,
      employeeName: empName,
      allowedTime: BREAK_LIMITS[breakType],
      actualTime: actualMinutes,
      status: 'completed',
      date: new Date().toLocaleDateString('en-IN'),
      time: new Date().toLocaleTimeString('en-IN', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: true 
      }),
    };
    
    setBreakHistory(prev => [...prev, breakRecord]);
    
    try {
      await saveBreakToFirebase(breakRecord);
      console.log('✅ Break completed record saved to Firebase');
    } catch (error) {
      console.error('❌ Failed to save break to Firebase:', error);
    }
  };


 // Start Shift - with immediate Firebase sync
const startShift = async () => {
  if (!empId) {
    alert('Please select an employee first');
    return;
  }

  const now = new Date();
  console.log('Starting shift at:', now.toISOString());
  
  setShiftStarted(true);
  setShiftStartTime(now);
  
  // Save shift to localStorage
  const shiftData = {
    empId,
    empName,
    empEmail,
    empPhone,
    shiftStartTime: now.toISOString(),
    totalBreakTime: 0
  };
  saveShiftToStorage(shiftData);
  
  const newRecord = {
    empId,
    empName,
    action: 'SHIFT_START',
    timestamp: now.toISOString(),
    date: now.toLocaleDateString('en-IN'),
    time: now.toLocaleTimeString('en-IN', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      hour12: true 
    }),
    shiftType: 'Regular',
  };
  
  // Add to activity history
  addActivity({
    action: 'SHIFT_START',
    message: `Shift started at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    timestamp: now,
    type: 'success'
  });
  
  // Save to local state
  setAttendanceData(prev => [...prev, newRecord]);
  
  // ✅ IMMEDIATELY SAVE TO FIREBASE
  try {
    await saveAttendanceToFirebase(newRecord);
    console.log('✅ Shift start saved to Firebase');
  } catch (error) {
    console.error('❌ Failed to save shift start to Firebase:', error);
  }
  
  console.log('SHIFT_START record added:', newRecord);
};
// End Shift - with Firebase sync
const endShift = async () => {
  if (!shiftStarted) {
    alert('Shift has not been started');
    return;
  }

  const now = new Date();
  console.log('Ending shift at:', now.toISOString());
  
  if (shiftStartTime && now < shiftStartTime) {
    alert('Error: End time cannot be before start time');
    return;
  }

  let workingHours = '0h 0m';
  if (shiftStartTime) {
    const diffMs = now - shiftStartTime;
    const totalMinutes = diffMs / (1000 * 60);
    const netMinutes = totalMinutes - totalBreakTime;
    
    if (netMinutes >= 0) {
      const hours = Math.floor(netMinutes / 60);
      const minutes = Math.round(netMinutes % 60);
      workingHours = `${hours}h ${minutes}m`;
    } else {
      workingHours = 'Invalid (Breaks > Duration)';
    }
  }

  const newRecord = {
    empId,
    empName,
    action: 'SHIFT_END',
    timestamp: now.toISOString(),
    date: new Date(shiftStartTime).toLocaleDateString('en-IN'),
    time: now.toLocaleTimeString('en-IN', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      hour12: true 
    }),
    workingHours,
    totalBreaks: totalBreakTime,
    shiftStartTimestamp: shiftStartTime?.toISOString(),
    shiftEndTimestamp: now.toISOString(),
    durationMinutes: Math.round((now - shiftStartTime) / (1000 * 60)),
  };
  
  // Add to activity history
  addActivity({
    action: 'SHIFT_END',
    message: `Shift ended. Working Hours: ${workingHours}, Total Breaks: ${totalBreakTime} minutes`,
    timestamp: now,
    workingHours,
    totalBreaks: totalBreakTime,
    type: 'info'
  });
  
  // Save to local state
  setAttendanceData(prev => [...prev, newRecord]);
  
  // ✅ IMMEDIATELY SAVE TO FIREBASE
  try {
    await saveAttendanceToFirebase(newRecord);
    console.log('✅ Shift end saved to Firebase');
  } catch (error) {
    console.error('❌ Failed to save shift end to Firebase:', error);
  }

  // Clear active break from localStorage
  clearActiveBreakFromStorage();
  
  // Clear shift from localStorage
  clearShiftFromStorage();

  // Reset shift state
  setShiftStarted(false);
  setShiftStartTime(null);
  setTotalBreakTime(0);
  setActiveBreak(null);

  console.log('SHIFT_END record added:', newRecord);
  alert(`✅ Shift ended successfully!\nWorking Hours: ${workingHours}\nTotal Breaks: ${totalBreakTime} minutes`);
};
const startBreak = async (type, minutes) => {
  if (!shiftStarted) {
    alert('Please start your shift first');
    return;
  }

  if (activeBreak) {
    alert('Please end your current break first');
    return;
  }

  const breakData = {
    type,
    minutes,
    startTime: Date.now(),
  };
  
  const breakRecord = {
    id: Date.now(),
    type: 'break_start',
    message: `${type} break started`,
    timestamp: new Date(),
    breakType: type,
    employee: empName,
    employeeId: empId,
    employeeName: empName,
    allowedTime: minutes,
    status: 'started',
    date: new Date().toLocaleDateString('en-IN'),
    time: new Date().toLocaleTimeString('en-IN', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      hour12: true 
    }),
    startTime: Date.now(),
  };
  
  setActiveBreak({
    ...breakData,
    timerKey: Date.now(),
  });

  // Save break to localStorage
  saveActiveBreakToStorage(breakData);

  // ✅ IMMEDIATELY SAVE BREAK START TO FIREBASE
  try {
    await saveBreakToFirebase(breakRecord);
    console.log('✅ Break start saved to Firebase');
  } catch (error) {
    console.error('❌ Failed to save break start to Firebase:', error);
  }

  // Add to activity history
  addActivity({
    action: 'BREAK_START',
    breakType: type,
    message: `${type} break started (${minutes} minutes)`,
    type: 'info'
  });
};

const endBreak = () => {
  if (!activeBreak) return;

  const elapsedMinutes = Math.ceil((Date.now() - activeBreak.startTime) / 60000);
  const newTotalBreakTime = totalBreakTime + elapsedMinutes;
  setTotalBreakTime(newTotalBreakTime);
  
  // Update localStorage with new break time
  const savedShift = getShiftFromStorage();
  if (savedShift) {
    savedShift.totalBreakTime = newTotalBreakTime;
    saveShiftToStorage(savedShift);
  }
  
  // Clear active break from localStorage
  clearActiveBreakFromStorage();
  
  if (elapsedMinutes <= activeBreak.minutes) {
    handleBreakComplete(activeBreak.type, elapsedMinutes);
  } else {
    handleBreakExceeded(activeBreak.type, (elapsedMinutes - activeBreak.minutes) * 60);
  }
  
  setActiveBreak(null);
};

  // Handle Leave
  const handleLeaveSubmit = async () => {
    if (!empId || !leaveData.from || !leaveData.to || !leaveData.reason) {
      alert('Please fill all leave details');
      return;
    }

    const newLeave = {
      empId,
      empName,
      fromDate: leaveData.from,
      toDate: leaveData.to,
      reason: leaveData.reason,
      status: 'Pending',
      appliedOn: new Date().toISOString(),
      employeeEmail: empEmail,
    };
    
    // Add to activity history
    addActivity({
      action: 'LEAVE_APPLIED',
      message: `Leave applied from ${new Date(leaveData.from).toLocaleDateString()} to ${new Date(leaveData.to).toLocaleDateString()}`,
      reason: leaveData.reason,
      type: 'info'
    });
    
    // Save to local state
    setLeaveDataLocal(prev => [...prev, newLeave]);
    
    // ✅ ALSO SAVE TO FIREBASE
    try {
      await saveLeaveToFirebase(newLeave);
      console.log('✅ Leave request saved to Firebase');
    } catch (error) {
      console.error('❌ Failed to save leave to Firebase:', error);
    }

    // Email notifications
    setEmailStatus('Submitting leave request and sending emails...');
    
    try {
      // Send to MANAGER
      if (notificationSettings.leaveApplied) {
        const managerEmailResult = await sendRealEmail(
          MANAGER.email,
          `📅 Leave Request: ${empName}`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #7c3aed; text-align: center;">Leave Request Notification</h2>
              <div style="background-color: #f5f3ff; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <h3 style="color: #5b21b6;">New Leave Request</h3>
                <div style="margin: 15px 0; padding: 15px; background: white; border-radius: 8px;">
                  <p><strong>Employee:</strong> ${empName} (${empId})</p>
                  <p><strong>From:</strong> ${new Date(leaveData.from).toLocaleDateString('en-IN')}</p>
                  <p><strong>To:</strong> ${new Date(leaveData.to).toLocaleDateString('en-IN')}</p>
                  <p><strong>Reason:</strong> ${leaveData.reason}</p>
                  <p><strong>Applied On:</strong> ${new Date().toLocaleString('en-IN')}</p>
                  <p><strong>Status:</strong> <span style="color: #f59e0b;">Pending Approval</span></p>
                </div>
              </div>
              <p style="text-align: center; color: #999; font-size: 12px;">
                Nova TechSciences HR Portal<br>
                Please review this leave request in the attendance portal.
              </p>
            </div>
          `
        );
        
        // Add email activity
        addActivity({
          action: 'EMAIL_SENT',
          recipient: MANAGER.email,
          subject: `Leave Request: ${empName}`,
          message: `Leave request email sent to manager`,
          type: 'info'
        });
      }
      
      // Send confirmation to EMPLOYEE
      if (notificationSettings.leaveApplied && empEmail) {
        const employeeEmailResult = await sendRealEmail(
          empEmail,
          `✅ Leave Application Submitted - ${empName}`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #10b981; text-align: center;">Leave Application Confirmation</h2>
              <div style="background-color: #ecfdf5; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <h3 style="color: #047857;">Leave Application Submitted Successfully</h3>
                <div style="margin: 15px 0; padding: 15px; background: white; border-radius: 8px;">
                  <p><strong>Employee:</strong> ${empName} (${empId})</p>
                  <p><strong>From:</strong> ${new Date(leaveData.from).toLocaleDateString('en-IN')}</p>
                  <p><strong>To:</strong> ${new Date(leaveData.to).toLocaleDateString('en-IN')}</p>
                  <p><strong>Reason:</strong> ${leaveData.reason}</p>
                  <p><strong>Applied On:</strong> ${new Date().toLocaleString('en-IN')}</p>
                  <p><strong>Status:</strong> <span style="color: #f59e0b;">Pending Approval</span></p>
                </div>
                <p style="color: #666; margin-top: 15px;">
                  Your leave request has been submitted to your manager for approval.
                  You will be notified once it's approved or rejected.
                </p>
              </div>
              <p style="text-align: center; color: #999; font-size: 12px;">
                Nova TechSciences Attendance Portal<br>
                This is an automated confirmation email.
              </p>
            </div>
          `
        );
        
        // Add email activity
        addActivity({
          action: 'EMAIL_SENT',
          recipient: empEmail,
          subject: `Leave Application Confirmation`,
          message: `Leave confirmation email sent to employee`,
          type: 'info'
        });
      }
      
      setEmailStatus('✅ Leave request submitted! Emails sent to manager and you.');
      alert('Leave request submitted successfully!');
      setLeaveOpen(false);
      setLeaveData({ from: '', to: '', reason: '' });
      
    } catch (error) {
      console.error('Error sending leave emails:', error);
      setEmailStatus('❌ Failed to send leave emails');
      alert('Leave saved but email notification failed.');
    }
  };

  // Send Daily Summary to All Employees
  const sendDailySummaryToAll = async () => {
    const password = prompt('Enter admin password to send daily summary:');
    if (password !== ADMIN_PASSWORD) {
      alert('Incorrect password');
      return;
    }

    setEmailStatus('Sending daily summaries to all employees...');

    try {
      const today = new Date().toLocaleDateString('en-IN');
      let successCount = 0;
      let failCount = 0;

      for (const employee of employees) {
        if (employee.email) {
          try {
            await sendRealEmail(
              employee.email,
              `📈 Daily Attendance Summary - ${today}`,
              `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #7c3aed; text-align: center;">Daily Attendance Summary</h2>
                  <div style="background-color: #f5f3ff; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3 style="color: #5b21b6;">Hello ${employee.name},</h3>
                    <p>Here's your daily attendance summary for <strong>${today}</strong>:</p>
                    
                    <div style="margin: 15px 0; padding: 15px; background: white; border-radius: 8px;">
                      <p><strong>Employee ID:</strong> ${employee.id}</p>
                      <p><strong>Name:</strong> ${employee.name}</p>
                      <p><strong>Shift Timing:</strong> ${employee.shift}</p>
                      <p><strong>Date:</strong> ${today}</p>
                    </div>
                    
                    <p style="color: #666; margin-top: 20px;">
                      This is an automated daily summary from Nova TechSciences Attendance Portal.
                    </p>
                  </div>
                  
                  <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
                    <p style="color: #999; font-size: 12px;">
                      Nova TechSciences<br>
                      Precision | Purity | Progress
                    </p>
                  </div>
                </div>
              `
            );
            
            // Add email activity
            addActivity({
              action: 'EMAIL_SENT',
              recipient: employee.email,
              subject: `Daily Attendance Summary`,
              message: `Daily summary sent to ${employee.name}`,
              type: 'info'
            });
            
            successCount++;
          } catch (error) {
            console.error(`Failed to send to ${employee.email}:`, error);
            failCount++;
          }
        }
      }

      // Add summary activity
      addActivity({
        action: 'DAILY_SUMMARY',
        message: `Daily summaries sent to ${successCount} employees. ${failCount} failed.`,
        successCount,
        failCount,
        type: 'info'
      });

      setEmailStatus(`✅ Daily summaries sent! Success: ${successCount}, Failed: ${failCount}`);
      alert(`Daily summaries sent to ${successCount} employees. ${failCount} failed.`);

    } catch (error) {
      console.error('Error sending daily summaries:', error);
      setEmailStatus('❌ Failed to send daily summaries');
    }
  };

  // Send Custom Email to Employee
  const sendCustomEmailToEmployee = async () => {
    if (!empEmail) {
      alert('Please select an employee first');
      return;
    }

    const subject = prompt('Enter email subject:');
    if (!subject) return;

    const message = prompt('Enter email message:');
    if (!message) return;

    setEmailStatus(`Sending email to ${empName}...`);

    try {
      await sendRealEmail(
        empEmail,
        subject,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">${subject}</h2>
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p>Dear ${empName},</p>
              <p>${message}</p>
            </div>
            <p style="color: #666; font-size: 14px;">
              This is an automated message from Nova TechSciences Attendance Portal.
            </p>
            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
            <p style="text-align: center; color: #999; font-size: 12px;">
              Nova TechSciences HR Department<br>
              ${new Date().toLocaleDateString()}
            </p>
          </div>
        `
      );
      
      // Add email activity
      addActivity({
        action: 'EMAIL_SENT',
        recipient: empEmail,
        subject: subject,
        message: `Custom email sent to ${empName}`,
        type: 'info'
      });

      setEmailStatus(`✅ Email sent to ${empName}!`);
      alert('Email sent successfully!');

    } catch (error) {
      console.error('Error sending custom email:', error);
      setEmailStatus('❌ Failed to send email');
    }
  };

 const downloadExcel = async () => {
  const password = prompt('Enter admin password:');
  if (password !== ADMIN_PASSWORD) {
    alert('Incorrect password');
    return;
  }

  try {
    console.log('📊 Starting Excel export...');
    console.log('🌐 Fetching data from Firebase...');
    
    // ✅ FETCH ALL DATA FROM FIREBASE
    let firebaseData;
    try {
      firebaseData = await fetchAllDataForExcel();
      console.log('✅ Data fetched from Firebase:', {
        attendance: firebaseData.attendance.length,
        breaks: firebaseData.breaks.length,
        leaves: firebaseData.leaves.length,
        activities: firebaseData.activities?.length || 0
      });
    } catch (firebaseError) {
      console.error('❌ Error fetching from Firebase:', firebaseError);
      alert('⚠️ Could not fetch from Firebase. Using local data instead.');
      
      // Fallback to local data
      firebaseData = {
        attendance: attendanceData,
        breaks: breakHistory,
        leaves: leaveDataLocal,
        activities: activityHistory
      };
    }
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // ==================== SHEET 1: DAILY ATTENDANCE (LOGIN/LOGOUT TIMES) ====================
    let attendanceByEmployeeDate = {}; // Define it here, outside the if block
    let dailyAttendance = []; // Define it here
    
    if (firebaseData.attendance.length > 0) {
      // Group attendance by employee and date
      attendanceByEmployeeDate = {};
      
      firebaseData.attendance.forEach(record => {
        if (!record.empId || !record.timestamp) return;
        
        const date = record.date || new Date(record.timestamp).toLocaleDateString('en-IN');
        const employeeId = record.empId;
        const key = `${employeeId}_${date}`;
        
        if (!attendanceByEmployeeDate[key]) {
          attendanceByEmployeeDate[key] = {
            employeeId,
            employeeName: record.empName || 'N/A',
            date,
            loginTime: null,
            logoutTime: null,
            loginDateTime: null,
            logoutDateTime: null,
            workingHours: null,
            totalBreaks: 0,
            shiftStartTimestamp: null,
            shiftEndTimestamp: null
          };
        }
        
        const attendance = attendanceByEmployeeDate[key];
        
        if (record.action === 'SHIFT_START') {
          const loginTime = new Date(record.timestamp);
          attendance.loginTime = loginTime.toLocaleTimeString('en-IN', { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit',
            hour12: true 
          });
          attendance.loginDateTime = loginTime.toLocaleString('en-IN');
          attendance.shiftStartTimestamp = record.timestamp;
        }
        
        if (record.action === 'SHIFT_END') {
          const logoutTime = new Date(record.timestamp);
          attendance.logoutTime = logoutTime.toLocaleTimeString('en-IN', { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit',
            hour12: true 
          });
          attendance.logoutDateTime = logoutTime.toLocaleString('en-IN');
          attendance.shiftEndTimestamp = record.timestamp;
          attendance.workingHours = record.workingHours || 'N/A';
          attendance.totalBreaks = record.totalBreaks || 0;
        }
      });
      
      // Convert to array and calculate durations
      dailyAttendance = Object.values(attendanceByEmployeeDate).map(attendance => {
        let workingHours = 'N/A';
        let durationMinutes = 'N/A';
        let status = 'Incomplete';
        
        if (attendance.loginTime && attendance.logoutTime && attendance.shiftStartTimestamp && attendance.shiftEndTimestamp) {
          try {
            const start = new Date(attendance.shiftStartTimestamp);
            const end = new Date(attendance.shiftEndTimestamp);
            
            if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
              const diffMs = end - start;
              durationMinutes = Math.round(diffMs / (1000 * 60));
              
              // Calculate net working hours (excluding breaks)
              const netMinutes = durationMinutes - (attendance.totalBreaks || 0);
              
              if (netMinutes >= 0) {
                const hours = Math.floor(netMinutes / 60);
                const minutes = Math.round(netMinutes % 60);
                workingHours = `${hours}h ${minutes}m`;
                status = 'Completed';
              } else {
                workingHours = 'Invalid: Breaks > Duration';
                status = 'Error';
              }
            }
          } catch (error) {
            console.error('Error calculating duration:', error);
          }
        } else if (attendance.loginTime) {
          status = 'Active (No logout)';
          workingHours = 'In Progress';
        }
        
        return {
          'Date': attendance.date,
          'Employee ID': attendance.employeeId,
          'Employee Name': attendance.employeeName,
          'Login Time': attendance.loginTime || 'N/A',
          'Login DateTime': attendance.loginDateTime || 'N/A',
          'Logout Time': attendance.logoutTime || 'N/A',
          'Logout DateTime': attendance.logoutDateTime || 'N/A',
          'Shift Status': status,
          'Working Hours': workingHours,
          'Total Breaks (min)': attendance.totalBreaks || 0,
          'Duration (min)': durationMinutes,
          'Remarks': '',
          'Record Type': attendance.loginTime && attendance.logoutTime ? 'Complete Shift' : 
                        attendance.loginTime ? 'Only Login' : 'Only Logout'
        };
      });
      
      // Sort by date (newest first)
      dailyAttendance.sort((a, b) => {
        const dateA = new Date(a.Date.split('/').reverse().join('-'));
        const dateB = new Date(b.Date.split('/').reverse().join('-'));
        return dateB - dateA;
      });
      
      if (dailyAttendance.length > 0) {
        const ws1 = XLSX.utils.json_to_sheet(dailyAttendance);
        XLSX.utils.book_append_sheet(wb, ws1, 'Daily Attendance');
        
        // Set column widths
        ws1['!cols'] = [
          { wch: 12 }, // Date
          { wch: 12 }, // Employee ID
          { wch: 20 }, // Employee Name
          { wch: 12 }, // Login Time
          { wch: 20 }, // Login DateTime
          { wch: 12 }, // Logout Time
          { wch: 20 }, // Logout DateTime
          { wch: 15 }, // Shift Status
          { wch: 15 }, // Working Hours
          { wch: 15 }, // Total Breaks
          { wch: 12 }, // Duration
          { wch: 25 }, // Remarks
          { wch: 15 }, // Record Type
        ];
      }
    }

    // ==================== SHEET 2: RAW ATTENDANCE LOGS ====================
    if (firebaseData.attendance.length > 0) {
      const rawLogsData = firebaseData.attendance.map(record => {
        const timestamp = record.timestamp ? new Date(record.timestamp) : new Date();
        return {
          'Date': timestamp.toLocaleDateString('en-IN'),
          'Time': timestamp.toLocaleTimeString('en-IN', { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit',
            hour12: true 
          }),
          'Employee ID': record.empId || record.employeeId,
          'Employee Name': record.empName || record.employeeName,
          'Action': record.action,
          'Working Hours': record.workingHours || '',
          'Total Breaks': record.totalBreaks || 0,
          'Duration (min)': record.durationMinutes || '',
          'Shift Type': record.shiftType || 'Regular',
          'Full Timestamp': timestamp.toLocaleString('en-IN'),
          'Firebase ID': record.id || 'N/A'
        };
      });
      
      const ws2 = XLSX.utils.json_to_sheet(rawLogsData);
      XLSX.utils.book_append_sheet(wb, ws2, 'Raw Attendance Logs');
    }

    // ==================== SHEET 3: ACTIVITY HISTORY ====================
    if (firebaseData.activities && firebaseData.activities.length > 0) {
      const activitySheetData = firebaseData.activities.map(activity => {
        const activityDate = activity.timestamp ? new Date(activity.timestamp) : new Date();
        return {
          'Date': activityDate.toLocaleDateString('en-IN'),
          'Time': activityDate.toLocaleTimeString('en-IN', { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit',
            hour12: true 
          }),
          'Employee ID': activity.employeeId || 'N/A',
          'Employee Name': activity.employeeName || 'N/A',
          'Action': activity.action || 'N/A',
          'Activity Type': activity.type || 'info',
          'Message': activity.message || 'N/A',
          'Break Type': activity.breakType || '',
          'Exceeded By (min)': activity.exceededBy || '',
          'Working Hours': activity.workingHours || '',
          'Total Breaks (min)': activity.totalBreaks || '',
          'Reason': activity.reason || '',
          'Email Recipient': activity.recipient || '',
          'Email Subject': activity.subject || '',
          'Browser': activity.browser || 'N/A',
          'Full Timestamp': activityDate.toLocaleString('en-IN')
        };
      });
      
      const ws3 = XLSX.utils.json_to_sheet(activitySheetData);
      XLSX.utils.book_append_sheet(wb, ws3, 'Activity History');
    }

    // ==================== SHEET 4: BREAK HISTORY WITH EXCEEDED TIMES ====================
    if (firebaseData.breaks.length > 0) {
      const breakSheetData = firebaseData.breaks.map(breakRec => {
        const breakDate = breakRec.timestamp ? new Date(breakRec.timestamp) : new Date();
        const allowedTime = breakRec.allowedTime || BREAK_LIMITS[breakRec.breakType] || 0;
        const exceededBy = breakRec.exceededBy || 0;
        const actualTime = allowedTime + exceededBy;
        const status = exceededBy > 0 ? 'Exceeded' : 'Completed';
        
        return {
          'Date': breakDate.toLocaleDateString('en-IN'),
          'Time': breakDate.toLocaleTimeString('en-IN'),
          'Employee ID': breakRec.employeeId || 'N/A',
          'Employee Name': breakRec.employeeName || breakRec.employee || 'N/A',
          'Break Type': breakRec.breakType || 'N/A',
          'Allowed Time (min)': allowedTime,
          'Actual Time (min)': actualTime,
          'Exceeded By (min)': exceededBy,
          'Status': status,
          'Exceeded Status': exceededBy > 0 ? 'YES' : 'NO',
          'Alert Type': breakRec.type || 'N/A',
          'Message': breakRec.message || 'N/A',
          'Firebase ID': breakRec.id || 'N/A'
        };
      });
      
      const ws4 = XLSX.utils.json_to_sheet(breakSheetData);
      XLSX.utils.book_append_sheet(wb, ws4, 'Break History');
    }

    // ==================== SHEET 5: LEAVE REQUESTS ====================
    if (firebaseData.leaves.length > 0) {
      const leaveSheetData = firebaseData.leaves.map(record => ({
        'Employee ID': record.empId || record.employeeId,
        'Employee Name': record.empName || record.employeeName,
        'Employee Email': employees.find(e => e.id === (record.empId || record.employeeId))?.email || 'N/A',
        'From Date': new Date(record.fromDate).toLocaleDateString('en-IN'),
        'To Date': new Date(record.toDate).toLocaleDateString('en-IN'),
        'Reason': record.reason || '',
        'Status': record.status || 'Pending',
        'Applied On': new Date(record.appliedOn).toLocaleString('en-IN'),
        'Total Days': calculateLeaveDays(record.fromDate, record.toDate),
      }));
      const ws5 = XLSX.utils.json_to_sheet(leaveSheetData);
      XLSX.utils.book_append_sheet(wb, ws5, 'Leave Requests');
    }

    // ==================== SHEET 6: EMPLOYEE DIRECTORY ====================
    const employeeSheetData = employees.map(emp => ({
      'Employee ID': emp.id,
      'Employee Name': emp.name,
      'Email': emp.email,
      'Phone': emp.phone,
      'Shift Timing': emp.shift,
      'Status': 'Active',
    }));
    const ws6 = XLSX.utils.json_to_sheet(employeeSheetData);
    XLSX.utils.book_append_sheet(wb, ws6, 'Employee Directory');

    // ==================== SHEET 7: SUMMARY REPORT ====================
    const today = new Date().toLocaleDateString('en-IN');
    
    // Get today's attendance - use the already calculated attendanceByEmployeeDate
    let todaysAttendance = [];
    let totalToday = 0;
    let completedToday = 0;
    let onlyLoginToday = 0;
    
    if (firebaseData.attendance.length > 0) {
      todaysAttendance = Object.values(attendanceByEmployeeDate).filter(att => att.date === today);
      totalToday = todaysAttendance.length;
      completedToday = todaysAttendance.filter(a => a.loginTime && a.logoutTime).length;
      onlyLoginToday = todaysAttendance.filter(a => a.loginTime && !a.logoutTime).length;
    }
    
    const totalExceededBreaks = firebaseData.breaks.filter(b => (b.exceededBy || 0) > 0).length;
    const totalActivities = firebaseData.activities?.length || 0;
    
    const summaryData = [
      ['Report Generated:', new Date().toLocaleString('en-IN')],
      ['Report Date:', today],
      ['Total Employees:', employees.length],
      ["Today's Attendance:", totalToday],
      ['Completed Shifts Today:', completedToday],
      ['Active Shifts (No Logout):', onlyLoginToday],
      ['Total Activities Recorded:', totalActivities],
      ['Total Breaks Recorded:', firebaseData.breaks.length],
      ['Exceeded Breaks:', totalExceededBreaks],
      ['Total Leave Requests:', firebaseData.leaves.length],
      ['Pending Leaves:', firebaseData.leaves.filter(l => l.status === 'Pending').length],
      ['Login/Logout Records:', firebaseData.attendance.filter(a => 
        a.action === 'SHIFT_START' || a.action === 'SHIFT_END').length],
      ['Data Source:', 'Firebase Firestore'],
      ['Cross-Browser Support:', '✅ Enabled'],
    ];
    
    const ws7 = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, ws7, 'Summary');

    // ==================== SHEET 8: ATTENDANCE SUMMARY BY EMPLOYEE ====================
    const employeeSummary = employees.map(emp => {
      const empAttendance = firebaseData.attendance.filter(a => a.empId === emp.id);
      const shifts = empAttendance.filter(a => a.action === 'SHIFT_START').length;
      const completedShifts = empAttendance.filter(a => a.action === 'SHIFT_END').length;
      const empBreaks = firebaseData.breaks.filter(b => b.employeeId === emp.id).length;
      const exceededBreaks = firebaseData.breaks.filter(b => 
        b.employeeId === emp.id && (b.exceededBy || 0) > 0
      ).length;
      
      // Get employee's attendance from dailyAttendance
      const empDailyAttendance = dailyAttendance.filter(a => a['Employee ID'] === emp.id);
      const completeShiftsCount = empDailyAttendance.filter(a => 
        a['Record Type'] === 'Complete Shift'
      ).length;
      
      return {
        'Employee ID': emp.id,
        'Employee Name': emp.name,
        'Total Shifts': shifts,
        'Completed Shifts': completeShiftsCount,
        'Incomplete Shifts': shifts - completeShiftsCount,
        'Total Breaks': empBreaks,
        'Exceeded Breaks': exceededBreaks,
        'Email': emp.email,
        'Shift Timing': emp.shift,
        'Performance': exceededBreaks > 0 ? 'Needs Improvement' : 'Good',
        'Last Login': empDailyAttendance.length > 0 ? 
          empDailyAttendance[0]['Login DateTime'] || 'N/A' : 'No records'
      };
    });
    
    const ws8 = XLSX.utils.json_to_sheet(employeeSummary);
    XLSX.utils.book_append_sheet(wb, ws8, 'Employee Summary');

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `NTS_Attendance_Report_${timestamp}.xlsx`;
    
    XLSX.writeFile(wb, fileName);
    
    // Show success message with details
    const totalLoginRecords = firebaseData.attendance.filter(a => a.action === 'SHIFT_START').length;
    const totalLogoutRecords = firebaseData.attendance.filter(a => a.action === 'SHIFT_END').length;
    const completeShiftsCount = Object.values(attendanceByEmployeeDate).filter(a => 
      a.loginTime && a.logoutTime
    ).length;
    
    alert(`✅ Report downloaded successfully!\n\n📊 Sheets: 8\n📁 File: ${fileName}\n\n`);
    
  } catch (error) {
    console.error('❌ Error downloading Excel:', error);
    alert('❌ Failed to download report: ' + error.message);
  }
};

  // Load data from Firebase on component mount
useEffect(() => {
  const loadDataFromFirebase = async () => {
    console.log('📥 Loading data from Firebase...');
    
    try {
      const data = await fetchAllDataForExcel();
      
      // Update local state with Firebase data
      setAttendanceData(data.attendance);
      setBreakHistory(data.breaks);
      setLeaveDataLocal(data.leaves);
      
      console.log('✅ Data loaded from Firebase:', {
        attendance: data.attendance.length,
        breaks: data.breaks.length,
        leaves: data.leaves.length
      });
      
    } catch (error) {
      console.error('❌ Error loading data from Firebase:', error);
    }
  };
  
  // Check for active shift in localStorage
  const savedShift = getShiftFromStorage();
  if (savedShift) {
    console.log('🔄 Restoring saved shift:', savedShift);
    
    // Check if shift is still valid (within same day)
    const shiftStartTime = new Date(savedShift.shiftStartTime);
    const now = new Date();
    const isSameDay = shiftStartTime.toDateString() === now.toDateString();
    
    if (isSameDay) {
      setEmpId(savedShift.empId);
      setEmpName(savedShift.empName);
      setEmpEmail(savedShift.empEmail);
      setEmpPhone(savedShift.empPhone);
      setShiftStarted(true);
      setShiftStartTime(shiftStartTime);
      setTotalBreakTime(savedShift.totalBreakTime || 0);
      
      // Check for active break
// Check for active break
const savedBreak = getActiveBreakFromStorage();
if (savedBreak) {
  console.log('🔄 Restoring active break:', savedBreak);
  
  // Calculate elapsed time since break started
  const breakStartTime = new Date(savedBreak.startTime);
  const now = new Date();
  const elapsedMs = now.getTime() - breakStartTime.getTime();
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const totalBreakSeconds = savedBreak.minutes * 60;
  
  if (elapsedSeconds < totalBreakSeconds) {
    // Break still has time remaining
    // Set active break with calculated elapsed time
    setActiveBreak({
      type: savedBreak.type,
      minutes: savedBreak.minutes, // Original minutes
      startTime: savedBreak.startTime,
      timerKey: Date.now(),
      elapsedSeconds: elapsedSeconds // Store elapsed seconds for TimerBar
    });
    
    const remainingMinutes = Math.floor((totalBreakSeconds - elapsedSeconds) / 60);
    const remainingSeconds = (totalBreakSeconds - elapsedSeconds) % 60;
    
    addActivity({
      action: 'BREAK_RESTORED',
      breakType: savedBreak.type,
      message: `${savedBreak.type} break restored. ${remainingMinutes}:${remainingSeconds.toString().padStart(2, '0')} remaining.`,
      type: 'info'
    });
    
    console.log(`✅ Break restored with ${remainingMinutes}:${remainingSeconds.toString().padStart(2, '0')} remaining`);
  } else {
    // Break already exceeded
    const exceededSeconds = elapsedSeconds - totalBreakSeconds;
    const exceededMinutes = Math.ceil(exceededSeconds / 60);
    
    // Mark as exceeded immediately
    setActiveBreak({
      type: savedBreak.type,
      minutes: savedBreak.minutes,
      startTime: savedBreak.startTime,
      timerKey: Date.now(),
      elapsedSeconds: totalBreakSeconds, // Mark as fully elapsed
      exceeded: true
    });
    
    // Trigger exceeded handler
    setTimeout(() => {
      handleBreakExceeded(savedBreak.type, exceededSeconds);
    }, 100);
    
    addActivity({
      action: 'BREAK_EXCEEDED',
      breakType: savedBreak.type,
      message: `${savedBreak.type} break already exceeded by ${exceededMinutes} minute(s)!`,
      exceededBy: exceededMinutes,
      type: 'warning'
    });
    
    clearActiveBreakFromStorage();
    console.log(`❌ Break already exceeded by ${exceededMinutes} minute(s)`);
  }
}
      
      // Add activity to history
      addActivity({
        action: 'SHIFT_RESTORED',
        message: `Shift restored from previous session. Started at ${shiftStartTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        type: 'info'
      });
      
      console.log('✅ Shift restored successfully');
    } else {
      console.log('❌ Saved shift is from a different day, clearing...');
      clearShiftFromStorage();
      clearActiveBreakFromStorage();
    }
  }
  
  loadDataFromFirebase();
}, []);
  // Filter activities by current employee
  const filteredActivities = useMemo(() => {
    if (!empId) return activityHistory;
    return activityHistory.filter(activity => activity.employeeId === empId);
  }, [activityHistory, empId]);

  // Get Icon Component for activity
  const getActivityIcon = (action) => {
    const IconComponent = activityIcons[action] || Activity;
    return <IconComponent className="w-4 h-4" />;
  };

  // Helper functions
  const calculateLeaveDays = (fromDate, toDate) => {
    if (!fromDate || !toDate) return 0;
    try {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      const diffTime = Math.abs(to - from);
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    } catch (error) {
      return 0;
    }
  };

  const calculateAverageShiftDuration = (shifts) => {
    const completedShifts = shifts.filter(shift => shift.status === 'Completed' && shift.workingHours);
    if (completedShifts.length === 0) return 'N/A';
    
    try {
      let totalMinutes = 0;
      completedShifts.forEach(shift => {
        const match = shift.workingHours.match(/(\d+)h\s*(\d+)m/);
        if (match) {
          const hours = parseInt(match[1]);
          const minutes = parseInt(match[2]);
          totalMinutes += (hours * 60) + minutes;
        }
      });
      
      const avgMinutes = totalMinutes / completedShifts.length;
      const avgHours = Math.floor(avgMinutes / 60);
      const avgMins = Math.round(avgMinutes % 60);
      return `${avgHours}h ${avgMins}m`;
    } catch (error) {
      return 'N/A';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-gray-900/95 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-teal-500 rounded-xl flex items-center justify-center">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent">
                  Nova TechSciences
                </h1>
                <p className="text-xs text-gray-400">Attendance & Break Management Portal</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="hidden md:flex items-center space-x-2 text-sm text-gray-400">
                <CalendarDays className="w-4 h-4" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
                />
              </div>
              
              <button
                onClick={() => setShowNotificationSettings(!showNotificationSettings)}
                className="flex items-center space-x-2 px-3 py-1.5 bg-gray-800 rounded-lg border border-gray-700 hover:bg-gray-700 transition-colors"
              >
                <Bell className="w-4 h-4 text-blue-400" />
                <span className="text-sm">Notifications</span>
              </button>

              {/* <button
  onClick={debugLocalStorage}
  className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white px-4 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-all hover:scale-105"
>
  <FileText className="w-5 h-5" />
  <span>Debug Storage</span>
</button> */}
              
              {/* Activity History Toggle Button */}
              <button
                onClick={() => setShowActivityHistory(!showActivityHistory)}
                className="flex items-center space-x-2 px-3 py-1.5 bg-gray-800 rounded-lg border border-gray-700 hover:bg-gray-700 transition-colors"
              >
                <History className="w-4 h-4 text-purple-400" />
                <span className="text-sm">Activity History</span>
              </button>
              {/* <button
  onClick={() => {
    if (confirm('Are you sure you want to force clear ALL local storage? This will reset everything including active shift and breaks.')) {
      clearShiftFromStorage();
      clearActiveBreakFromStorage();
      setShiftStarted(false);
      setShiftStartTime(null);
      setTotalBreakTime(0);
      setActiveBreak(null);
      setEmpId("");
      setEmpName("");
      setEmpEmail("");
      setEmpPhone("");
      alert('All local storage cleared!');
    }
  }}
  className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white px-4 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-all hover:scale-105"
>
  <X className="w-5 h-5" />
  <span>Force Clear All</span>
</button> */}
            </div>
          </div>
        </div>
      </header>

      {/* Activity History Panel */}
      {showActivityHistory && (
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white flex items-center">
                <History className="w-5 h-5 mr-2 text-purple-400" />
                Activity History ({filteredActivities.length})
              </h3>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setActivityHistory([])}
                  className="text-sm text-gray-400 hover:text-white hover:bg-gray-700 px-2 py-1 rounded-lg transition-colors"
                >
                  Clear All
                </button>
                <button
                  onClick={() => setShowActivityHistory(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            {filteredActivities.length === 0 ? (
              <div className="text-center py-8">
                <History className="w-12 h-12 mx-auto mb-3 text-gray-700" />
                <p className="text-gray-500">No activities recorded yet</p>
                <p className="text-sm text-gray-600 mt-1">Start working to see activity history</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                {filteredActivities.map((activity) => {
                  const Icon = activityIcons[activity.action] || Activity;
                  return (
                    <div
                      key={activity.id}
                      className={`p-4 rounded-xl border ${activityBgColors[activity.action] || 'bg-gray-800/50 border-gray-700'}`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-start space-x-3">
                          <div className={`p-2 rounded-lg ${activityBgColors[activity.action]?.replace('border', 'bg') || 'bg-gray-700'}`}>
                            <Icon className={`w-4 h-4 ${activityColors[activity.action] || 'text-gray-400'}`} />
                          </div>
                          <div>
                            <p className={`font-medium ${activityColors[activity.action] || 'text-gray-300'}`}>
                              {activity.message}
                            </p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {activity.breakType && (
                                <span className="text-xs px-2 py-1 bg-amber-900/30 text-amber-300 rounded-full">
                                  {activity.breakType}
                                </span>
                              )}
                              {activity.exceededBy && (
                                <span className="text-xs px-2 py-1 bg-red-900/30 text-red-300 rounded-full">
                                  +{activity.exceededBy} min
                                </span>
                              )}
                              {activity.workingHours && (
                                <span className="text-xs px-2 py-1 bg-blue-900/30 text-blue-300 rounded-full">
                                  {activity.workingHours}
                                </span>
                              )}
                              {activity.totalBreaks && (
                                <span className="text-xs px-2 py-1 bg-emerald-900/30 text-emerald-300 rounded-full">
                                  {activity.totalBreaks} min breaks
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                              {activity.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {' • '}
                              {activity.timestamp.toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setActivityHistory(prev => prev.filter(a => a.id !== activity.id))}
                          className="text-gray-500 hover:text-white p-1 hover:bg-gray-800 rounded-lg transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notification Settings Panel */}
      {showNotificationSettings && (
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">Email Notification Settings</h3>
              <button
                onClick={() => setShowNotificationSettings(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(notificationSettings).map(([key, value]) => (
                <label key={key} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => setNotificationSettings(prev => ({
                      ...prev,
                      [key]: e.target.checked
                    }))}
                    className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-300 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Email Status Banner */}
        {emailStatus && (
          <div className="bg-gradient-to-r from-blue-900/30 to-teal-900/30 border border-blue-800/30 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Mail className="w-5 h-5 text-blue-400" />
                <div>
                  <p className="font-medium text-blue-300">{emailStatus}</p>
                  <p className="text-xs text-blue-400/70">
                    Employee: <span className="text-blue-300">{empEmail || 'Not selected'}</span>
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setEmailStatus(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Employee & Actions */}
          <div className="lg:col-span-2 space-y-6">
            {/* Employee Card */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 backdrop-blur-sm">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-white mb-2 flex items-center">
                    <User className="w-5 h-5 mr-2 text-blue-400" />
                    Employee Information
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-2">
                        Select Your Name
                      </label>
                      <select
                        value={empId}
                        onChange={(e) => {
                          const id = e.target.value;
                          const emp = employees.find(e => e.id === id);
                          if (emp) {
                            setEmpId(id);
                            setEmpName(emp.name);
                            setEmpEmail(emp.email);
                            setEmpPhone(emp.phone);
                          }
                        }}
                        disabled={shiftStarted}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white disabled:bg-gray-900 disabled:border-gray-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                      >
                        <option value="" className="bg-gray-800">-- Select Employee --</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id} className="bg-gray-800">
                            {emp.id} - {emp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-2">
                        Shift Timing
                      </label>
                      <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3">
                        <div className="flex items-center">
                          <Clock className="w-4 h-4 mr-2 text-amber-400" />
                          <span className="text-white">{currentEmployee?.shift || 'Not selected'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {currentEmployee && (
                    <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                      <div className="flex items-center space-x-4 mb-3">
                        <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-teal-500 rounded-full flex items-center justify-center">
                          <span className="font-bold text-white">{currentEmployee.name.charAt(0)}</span>
                        </div>
                        <div>
                          <p className="font-semibold text-white">{currentEmployee.name}</p>
                          <p className="text-sm text-gray-400">{currentEmployee.id}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex items-center space-x-2">
                          <AtSign className="w-4 h-4 text-blue-400" />
                          <div>
                            <p className="text-xs text-gray-500">Email</p>
                            <p className="text-sm text-white">{currentEmployee.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Smartphone className="w-4 h-4 text-green-400" />
                          <div>
                            <p className="text-xs text-gray-500">Phone</p>
                            <p className="text-sm text-white">{currentEmployee.phone}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex space-x-3">
                  {!shiftStarted ? (
                    <button
                      onClick={startShift}
                      disabled={!empId}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105"
                    >
                      <Play className="w-5 h-5" />
                      <span>Start Shift</span>
                    </button>
                  ) : (
                    <button
                      onClick={endShift}
                      className="bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-all hover:scale-105"
                    >
                      <StopCircle className="w-5 h-5" />
                      <span>End Shift</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Break Management */}
            {shiftStarted && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 backdrop-blur-sm">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                  <Activity className="w-5 h-5 mr-2 text-amber-400" />
                  Take a Break
                </h3>
                
                {/* Active Break Timer */}
    {/* Active Break Timer */}
{activeBreak ? (
  <div className="mb-6 p-5 bg-gradient-to-r from-gray-800 to-gray-900 border border-gray-700 rounded-xl">
    <div className="flex items-center justify-between mb-6">
      <div>
        <h4 className="font-bold text-white text-xl">
          ⏱️ Active: {activeBreak.type} Break
        </h4>
        <p className="text-sm text-gray-400 mt-1">
          Allowed: <span className="text-emerald-400 font-semibold">{activeBreak.minutes} minutes</span>
        </p>
        {activeBreak.elapsedSeconds > 0 && (
          <p className="text-sm text-amber-400 mt-1">
            Continuing from previous session • 
            {Math.floor(activeBreak.elapsedSeconds / 60)}:{String(activeBreak.elapsedSeconds % 60).padStart(2, '0')} already elapsed
          </p>
        )}
      </div>
      <button
        onClick={endBreak}
        className="bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white px-4 py-2 rounded-lg font-semibold transition-all hover:scale-105"
      >
        End Break Now
      </button>
    </div>
    
    <TimerBar
      totalSeconds={activeBreak.minutes * 60}
      breakType={activeBreak.type}
      elapsedSeconds={activeBreak.elapsedSeconds || 0}
      onComplete={() => {
        playNotificationSound();
        setShowBreakOverModal(true);
      }}
      onExceed={(exceededSeconds) => {
        handleBreakExceeded(activeBreak.type, exceededSeconds);
      }}
    />
    
    <div className="mt-6 p-4 bg-blue-900/30 border border-blue-800/30 rounded-lg">
      <p className="text-sm text-blue-300 flex items-center">
        <Mail className="w-4 h-4 mr-2" />
        Both you and manager will receive email alerts if break is exceeded
      </p>
    </div>
  </div>
) : (
                  /* Break Buttons */
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <button
                      onClick={() => startBreak('Tea', 15)}
                      className="bg-gradient-to-br from-amber-900/30 to-amber-800/20 hover:from-amber-800/40 hover:to-amber-700/30 border border-amber-800/30 p-5 rounded-xl flex flex-col items-center justify-center space-y-2 transition-all hover:scale-105 hover:border-amber-700/50 group"
                    >
                      <Coffee className="w-10 h-10 text-amber-400 group-hover:text-amber-300" />
                      <span className="font-semibold text-amber-300">Tea Break</span>
                      <span className="text-sm bg-amber-900/50 text-amber-300 px-3 py-1 rounded-full border border-amber-800/50">15 min</span>
                    </button>

                    <button
                      onClick={() => startBreak('Lunch', 30)}
                      className="bg-gradient-to-br from-emerald-900/30 to-emerald-800/20 hover:from-emerald-800/40 hover:to-emerald-700/30 border border-emerald-800/30 p-5 rounded-xl flex flex-col items-center justify-center space-y-2 transition-all hover:scale-105 hover:border-emerald-700/50 group"
                    >
                      <Sandwich className="w-10 h-10 text-emerald-400 group-hover:text-emerald-300" />
                      <span className="font-semibold text-emerald-300">Lunch</span>
                      <span className="text-sm bg-emerald-900/50 text-emerald-300 px-3 py-1 rounded-full border border-emerald-800/50">30 min</span>
                    </button>

                    <button
                      onClick={() => startBreak('Evening', 15)}
                      className="bg-gradient-to-br from-orange-900/30 to-orange-800/20 hover:from-orange-800/40 hover:to-orange-700/30 border border-orange-800/30 p-5 rounded-xl flex flex-col items-center justify-center space-y-2 transition-all hover:scale-105 hover:border-orange-700/50 group"
                    >
                      <Moon className="w-10 h-10 text-orange-400 group-hover:text-orange-300" />
                      <span className="font-semibold text-orange-300">Evening</span>
                      <span className="text-sm bg-orange-900/50 text-orange-300 px-3 py-1 rounded-full border border-orange-800/50">15 min</span>
                    </button>

                    <button
                      onClick={() => startBreak('Breather', 5)}
                      className="bg-gradient-to-br from-sky-900/30 to-sky-800/20 hover:from-sky-800/40 hover:to-sky-700/30 border border-sky-800/30 p-5 rounded-xl flex flex-col items-center justify-center space-y-2 transition-all hover:scale-105 hover:border-sky-700/50 group"
                    >
                      <Wind className="w-10 h-10 text-sky-400 group-hover:text-sky-300" />
                      <span className="font-semibold text-sky-300">Breather</span>
                      <span className="text-sm bg-sky-900/50 text-sky-300 px-3 py-1 rounded-full border border-sky-800/50">5 min</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 backdrop-blur-sm">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                <Activity className="w-5 h-5 mr-2 text-blue-400" />
                Quick Actions
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <button
                  onClick={() => setLeaveOpen(true)}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-all hover:scale-105"
                >
                  <CalendarDays className="w-5 h-5" />
                  <span>Apply Leave</span>
                </button>

                <button
                  onClick={downloadExcel}
                  className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-4 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-all hover:scale-105"
                >
                  <Download className="w-5 h-5" />
                  <span>Download Report</span>
                </button>
                
                <button
                  onClick={sendCustomEmailToEmployee}
                  disabled={!empEmail}
                  className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-4 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Mail className="w-5 h-5" />
                  <span>Email Employee</span>
                </button>
                
                <button
                  onClick={sendDailySummaryToAll}
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white px-4 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-all hover:scale-105"
                >
                  <Send className="w-5 h-5" />
                  <span>Send Daily Summary</span>
                </button>
                
                <button
                  onClick={async () => {
                    setEmailStatus('Sending test email...');
                    const result = await sendRealEmail(
                      empEmail || MANAGER.email,
                      'Test Email from Attendance Portal',
                      '<h1>Test Email</h1><p>This is a test email from your attendance portal.</p>'
                    );
                    if (result.success) {
                      setEmailStatus('✅ Test email sent successfully!');
                      alert('Test email sent! Check your inbox.');
                    } else {
                      setEmailStatus('❌ Failed to send test email');
                    }
                  }}
                  className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white px-4 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-all hover:scale-105"
                >
                  <CheckCircle className="w-5 h-5" />
                  <span>Test Email</span>
                </button>

                {/* Debug Button */}
                <button
                  onClick={() => {
                    console.log('=== DEBUG ATTENDANCE DATA ===');
                    console.log('Total records:', attendanceData.length);
                    
                    const shiftStarts = attendanceData.filter(r => r.action === 'SHIFT_START');
                    const shiftEnds = attendanceData.filter(r => r.action === 'SHIFT_END');
                    
                    console.log('SHIFT_START records:', shiftStarts.length);
                    console.log('SHIFT_END records:', shiftEnds.length);
                    
                    alert(`Attendance Data Debug:\n
                    Total Records: ${attendanceData.length}\n
                    SHIFT_START: ${shiftStarts.length}\n
                    SHIFT_END: ${shiftEnds.length}\n
                    Check console for details.`);
                  }}
                  className="bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-700 hover:to-amber-700 text-white px-4 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-all hover:scale-105"
                >
                  <FileText className="w-5 h-5" />
                  <span>Debug Data</span>
                </button>
              </div>
              
            </div>
          </div>

          {/* Right Column - Alerts */}
          <div className="space-y-6">
            {/* Alerts Dashboard */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 backdrop-blur-sm h-full">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-700">
                <h3 className="text-lg font-bold text-white flex items-center">
                  <Bell className="w-5 h-5 mr-2 text-amber-400" />
                  Recent Activities
                </h3>
                {alerts.length > 0 && (
                  <button
                    onClick={() => setAlerts([])}
                    className="text-sm text-gray-400 hover:text-white hover:bg-gray-800 px-2 py-1 rounded-lg transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
              
              {alerts.length === 0 ? (
                <div className="text-center py-8">
                  <Bell className="w-12 h-12 mx-auto mb-3 text-gray-700" />
                  <p className="text-gray-500">No activities yet</p>
                  <p className="text-sm text-gray-600 mt-1">Your activities will appear here</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto pr-2">
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`p-4 rounded-xl border ${
                        alert.type === 'warning'
                          ? 'bg-gradient-to-r from-red-900/20 to-red-800/10 border-red-800/30'
                          : alert.type === 'success'
                          ? 'bg-gradient-to-r from-emerald-900/20 to-emerald-800/10 border-emerald-800/30'
                          : 'bg-gradient-to-r from-blue-900/20 to-blue-800/10 border-blue-800/30'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center mb-2">
                            {alert.type === 'warning' && <AlertCircle className="w-4 h-4 text-red-400 mr-2" />}
                            {alert.type === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400 mr-2" />}
                            {!alert.type && alert.action === 'SHIFT_START' && <LogIn className="w-4 h-4 text-green-400 mr-2" />}
                            {!alert.type && alert.action === 'SHIFT_END' && <LogOutIcon className="w-4 h-4 text-blue-400 mr-2" />}
                            {!alert.type && alert.action?.includes('BREAK') && <CoffeeIcon className="w-4 h-4 text-amber-400 mr-2" />}
                            {!alert.type && alert.action === 'LEAVE_APPLIED' && <Calendar className="w-4 h-4 text-purple-400 mr-2" />}
                            {!alert.type && alert.action === 'EMAIL_SENT' && <Mail className="w-4 h-4 text-indigo-400 mr-2" />}
                            <p className={`font-medium ${
                              alert.type === 'warning' ? 'text-red-300' : 
                              alert.type === 'success' ? 'text-emerald-300' : 
                              'text-blue-300'
                            }`}>
                              {alert.message}
                            </p>
                          </div>
                          <p className="text-xs text-gray-500">
                            {alert.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {alert.exceededBy && (
                              <span className="ml-2 px-2 py-0.5 bg-red-900/30 text-red-300 rounded-full text-xs">
                                +{alert.exceededBy} min
                              </span>
                            )}
                            {alert.action === 'SHIFT_START' && (
                              <span className="ml-2 px-2 py-0.5 bg-green-900/30 text-green-300 rounded-full text-xs">
                                Shift Start
                              </span>
                            )}
                            {alert.action === 'SHIFT_END' && (
                              <span className="ml-2 px-2 py-0.5 bg-blue-900/30 text-blue-300 rounded-full text-xs">
                                Shift End
                              </span>
                            )}
                            {alert.action === 'LEAVE_APPLIED' && (
                              <span className="ml-2 px-2 py-0.5 bg-purple-900/30 text-purple-300 rounded-full text-xs">
                                Leave
                              </span>
                            )}
                          </p>
                        </div>
                        <button
                          onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}
                          className="text-gray-500 hover:text-white p-1 hover:bg-gray-800 rounded-lg transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Stats Card */}
            {shiftStarted && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 backdrop-blur-sm">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                  <Clock className="w-5 h-5 mr-2 text-blue-400" />
                  Shift Stats
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Shift Started</span>
                    <span className="font-semibold text-white">
                      {shiftStartTime?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Total Breaks</span>
                    <span className="font-semibold text-white">{totalBreakTime} min</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Active Breaks</span>
                    <span className="font-semibold text-white">{activeBreak ? 1 : 0}</span>
                  </div>
                  <div className="pt-4 border-t border-gray-700">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Current Time</span>
                      <span className="font-bold text-blue-400">
                        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Break Over Modal */}
      <Modal isOpen={showBreakOverModal} onClose={() => setShowBreakOverModal(false)}>
        <div className="text-center p-2">
          <div className="w-16 h-16 bg-gradient-to-r from-red-900 to-red-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-300" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">⏰ Break Time Exceeded!</h3>
          <p className="text-gray-300 mb-4">
            {activeBreak?.type} break time is over!
            {alerts[0]?.exceededBy && ` Exceeded by ${alerts[0]?.exceededBy} minute(s).`}
          </p>
          
          {emailStatus && (
            <div className={`p-3 rounded-lg mb-4 ${
              emailStatus.includes('✅') 
                ? 'bg-emerald-900/30 border border-emerald-800/50 text-emerald-300'
                : emailStatus.includes('❌')
                ? 'bg-red-900/30 border border-red-800/50 text-red-300'
                : 'bg-blue-900/30 border border-blue-800/50 text-blue-300'
            }`}>
              <div className="flex items-center justify-center">
                <Send className="w-4 h-4 mr-2" />
                <span className="text-sm">{emailStatus}</span>
              </div>
              {emailStatus.includes('✅') && (
                <p className="text-xs mt-1 opacity-80">
                  Both you and manager have been notified via email
                </p>
              )}
            </div>
          )}
          
          <div className="bg-amber-900/30 border border-amber-800/50 rounded-lg p-4 mb-6">
            <p className="text-sm text-amber-300 flex items-center justify-center">
              <Mail className="w-4 h-4 mr-2" />
              <span>Emails sent to:</span>
            </p>
            <div className="mt-2 space-y-1 text-sm">
              <p className="text-blue-300">👨‍💼 Manager: <strong>{MANAGER.email}</strong></p>
              <p className="text-green-300">👤 You: <strong>{empEmail}</strong></p>
            </div>
          </div>
          
          <button
            onClick={() => {
              setShowBreakOverModal(false);
              if (activeBreak) endBreak();
            }}
            className="w-full bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white py-3 rounded-lg font-semibold transition-all hover:scale-105"
          >
            Acknowledge & End Break
          </button>
        </div>
      </Modal>

      {/* Leave Modal */}
      <Modal isOpen={leaveOpen} onClose={() => setLeaveOpen(false)} title="Apply for Leave">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              From Date
            </label>
            <input
              type="date"
              value={leaveData.from}
              onChange={(e) => setLeaveData({...leaveData, from: e.target.value})}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              To Date
            </label>
            <input
              type="date"
              value={leaveData.to}
              onChange={(e) => setLeaveData({...leaveData, to: e.target.value})}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Reason for Leave
            </label>
            <textarea
              value={leaveData.reason}
              onChange={(e) => setLeaveData({...leaveData, reason: e.target.value})}
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Please provide a detailed reason..."
            />
          </div>

          <div className="bg-blue-900/30 border border-blue-800/50 p-4 rounded-lg">
            <div className="flex items-center">
              <Send className="w-5 h-5 text-blue-400 mr-3" />
              <div>
                <p className="text-sm font-medium text-blue-300">Email Notification</p>
                <p className="text-xs text-blue-400/80">
                  Will be sent to: <strong className="text-blue-300">{MANAGER.email}</strong>
                </p>
                <p className="text-xs text-green-400/80 mt-1">
                  You will also receive a confirmation email at: <strong>{empEmail}</strong>
                </p>
              </div>
            </div>
          </div>

          {emailStatus && emailStatus.includes('leave') && (
            <div className="p-3 bg-emerald-900/30 border border-emerald-800/50 rounded-lg">
              <p className="text-sm text-emerald-300 flex items-center">
                <CheckCircle className="w-4 h-4 mr-2" />
                {emailStatus}
              </p>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-700">
            <button
              onClick={() => setLeaveOpen(false)}
              className="px-4 py-2.5 border border-gray-700 rounded-lg text-gray-300 hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleLeaveSubmit}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-6 py-2.5 rounded-lg font-semibold flex items-center space-x-2 transition-all hover:scale-105"
            >
              <Send className="w-4 h-4" />
              <span>Submit & Send Emails</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-6 border-t border-gray-800 mt-8">
        <div className="text-center text-gray-500 text-sm">
          <p>Nova TechSciences Attendance Portal v2.0</p>
          <p className="mt-1">Email Notifications Active • All employee communications enabled</p>
          <p className="mt-2 text-xs text-gray-600">
            Manager: {MANAGER.name} • {MANAGER.email}
          </p>
        </div>
      </footer>
    </div>
  );
}