'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CheckCheck,
  Clock3,
  Coffee,
  Dot,
  FileText,
  FileSpreadsheet,
  IndianRupee,
  LayoutDashboard,
  Loader2,
  Moon,
  NotebookText,
  Play,
  ShieldAlert,
   StopCircle,
  SunMedium,
  UserCircle2,
} from "lucide-react";
import Login from "@/components/Login";
import { useAuth } from "@/contexts/AuthContext";
import { employees } from "@/utils/constants";
import { isManager } from "@/utils/roles";
import {
  assignHalfDayLeaveByManager,
  cancelLeaveRequest,
  cancelManagerAssignedLeave,
  createNotification,
  createTask,
  fetchLeaveRequests,
  fetchMonthlyAttendanceSummary,
  fetchNotifications,
  fetchPortalSettings,
  markAllNotificationsRead,
  markNotificationRead,
  fetchPendingCounts,
  setSaturdayHoliday,
  fetchTasks,
  fetchWorksheets,
  reviewLeaveRequest,
  submitLeaveRequest,
  updateTaskStatus,
  upsertWorksheet,
} from "@/lib/portal-helpers";
import { fetchAllAttendanceData, fetchAllBreaksData } from "@/lib/firebase-helpers";

const getToday = () => new Date().toISOString().slice(0, 10);
const formatDate = (date) => (date ? new Date(date).toLocaleDateString("en-IN") : "-");
const toMonthInputValue = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const FIXED_SHIFT_LABEL = "10:00 AM - 7:00 PM";
const SHIFT_START_HOUR = 10;
const AUTO_SYNC_MS = 15000;
const LIVE_BREAK_POLL_MS = 4000;
const formatDuration = (msValue = 0) => {
  const ms = Math.max(0, msValue);
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
};
const BREAK_TARGET_MINUTES = {
  Tea: 15,
  Lunch: 45,
  Evening: 15,
  Breather: 10,
};
const notificationMeta = {
  task: { label: "Task", icon: BriefcaseBusiness, tone: "bg-blue-100 text-blue-700" },
  leave: { label: "Leave", icon: CalendarClock, tone: "bg-amber-100 text-amber-700" },
  worksheet: { label: "Worksheet", icon: FileText, tone: "bg-emerald-100 text-emerald-700" },
  reimbursement: { label: "Reimbursement", icon: IndianRupee, tone: "bg-violet-100 text-violet-700" },
  correction: { label: "Correction", icon: ShieldAlert, tone: "bg-rose-100 text-rose-700" },
  info: { label: "Info", icon: Bell, tone: "bg-slate-100 text-slate-700" },
};
const tabMeta = {
  attendance: { label: "Attendance", icon: Clock3 },
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  profile: { label: "Profile", icon: UserCircle2 },
  leave: { label: "Leave", icon: CalendarClock },
  tasks: { label: "Tasks", icon: BriefcaseBusiness },
  worksheets: { label: "Worksheets", icon: NotebookText },
  calendar: { label: "Calendar", icon: CalendarDays },
  exports: { label: "Exports", icon: FileSpreadsheet },
};
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const HOLIDAY_MAP = {
  "2026-01-01": "New Year",
  "2026-01-14": "Makar Sankranti",
  "2026-01-26": "Republic Day",
  "2026-03-04": "Holi",
  "2026-08-15": "Independence Day",
  "2026-08-29": "Ganesh Chaturthi",
  "2026-10-02": "Gandhi Jayanti",
  "2026-10-20": "Dussehra",
  "2026-11-08": "Diwali",
  "2026-12-25": "Christmas",
};
const toDateKey = (year, monthIndex, day) =>
  `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const formatTimeAgo = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : null;
  if (!date || Number.isNaN(date.getTime())) return "Just now";

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-IN");
};
const formatActionLabel = (value) => {
  const action = String(value || "").toLowerCase();
  if (action === "clock-in") return "Shift Start";
  if (action === "clock-out") return "Shift End";
  if (action === "break-start") return "Break Start";
  if (action === "break-end") return "Break End";
  return value || "-";
};
const formatRoleLabel = (value) => {
  const role = String(value || "").trim().toLowerCase();
  if (!role) return "-";
  return `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
};
const toInputDateValue = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parseInputDate = (value) => {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};
const rowTime = (row) => {
  const dt = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp || Date.now());
  return dt.getTime();
};

const statusClass = {
  pending_l1: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-white",
  pending_l2: "bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-white",
  approved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-white",
  rejected: "bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-white",
  submitted: "bg-blue-100 text-blue-900 dark:bg-violet-500/20 dark:text-white",
  reviewed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-white",
  needs_changes: "bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-white",
  assigned: "bg-slate-100 text-slate-900 dark:bg-slate-700/40 dark:text-white",
  in_progress: "bg-blue-100 text-blue-900 dark:bg-violet-500/20 dark:text-white",
  completed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-white",
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-white",
  cancelled: "bg-slate-200 text-slate-800 dark:bg-slate-700/40 dark:text-white",
};
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
const btnPrimary = `${btnBase} border-slate-900 bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 dark:border-violet-500/70 dark:bg-violet-600 dark:hover:bg-violet-500 dark:shadow-[0_8px_24px_-10px_rgba(139,92,246,0.75)]`;
const btnSuccess = `${btnBase} border-emerald-600 bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700`;
const btnDanger = `${btnBase} border-rose-600 bg-rose-600 px-3 py-2 text-white hover:bg-rose-700`;
const btnSecondary = `${btnBase} border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800`;
const btnTinyPrimary = `${btnBase} border-slate-900 bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800 dark:border-violet-500/70 dark:bg-violet-600 dark:hover:bg-violet-500`;
const btnTinySuccess = `${btnBase} border-emerald-600 bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700`;
const btnTinyDanger = `${btnBase} border-rose-600 bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-700`;

function SectionCard({ title, children, right }) {
  return (
    <section className="overflow-visible rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.45)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function PortalPage() {
  const { user, isAuthenticated, loading, logout } = useAuth();
  const role = isManager(user?.role) ? "manager" : "employee";
  const [activeTab, setActiveTab] = useState("dashboard");
  const [theme, setTheme] = useState("light");
  const [refreshToken, setRefreshToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingAction, setLoadingAction] = useState("");
  const [message, setMessage] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [miniCalendarDate, setMiniCalendarDate] = useState(new Date());
  const [notificationFilter, setNotificationFilter] = useState("all");
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const notificationsRef = useRef(null);
  const autoShiftCloseKeyRef = useRef("");
  const employeeDefaultTabAppliedRef = useRef(false);

  const [notifications, setNotifications] = useState([]);
  const [leaveRows, setLeaveRows] = useState([]);
  const [taskRows, setTaskRows] = useState([]);
  const [worksheetRows, setWorksheetRows] = useState([]);
  const [pendingCounts, setPendingCounts] = useState({ leaves: 0, worksheets: 0 });

  const [monthFilter, setMonthFilter] = useState(toMonthInputValue());
  const [worksheetExportMode, setWorksheetExportMode] = useState("day");
  const [worksheetExportDay, setWorksheetExportDay] = useState(getToday());
  const [worksheetExportMonth, setWorksheetExportMonth] = useState(toMonthInputValue());
  const [activityExportMode, setActivityExportMode] = useState("day");
  const [activityExportDay, setActivityExportDay] = useState(getToday());
  const [activityExportMonth, setActivityExportMonth] = useState(toMonthInputValue());
  const [activityEmployeeFilter, setActivityEmployeeFilter] = useState("all");
  const [monthlySummary, setMonthlySummary] = useState([]);
  const [attendanceRaw, setAttendanceRaw] = useState([]);
  const [breakRows, setBreakRows] = useState([]);

  const [leaveForm, setLeaveForm] = useState({ fromDate: "", toDate: "", reason: "", leaveType: "General" });
  const [managerHalfDayForm, setManagerHalfDayForm] = useState({ employeeId: "", date: getToday(), reason: "Late arrival" });
  const [saturdayHolidayDate, setSaturdayHolidayDate] = useState(getToday());
  const [saturdayHolidayDates, setSaturdayHolidayDates] = useState([]);
  const [taskForm, setTaskForm] = useState({ title: "", details: "", assignedTo: "", priority: "medium", dueDate: "" });
  const [taskSearch, setTaskSearch] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState("all");
  const [lockedTaskId, setLockedTaskId] = useState("");
  const [worksheetForm, setWorksheetForm] = useState({ date: getToday(), taskSummary: "", blockers: "" });
  const [shiftRunning, setShiftRunning] = useState(false);
  const [shiftStartAt, setShiftStartAt] = useState(null);
  const [activeBreakType, setActiveBreakType] = useState("");
  const [breakStartAt, setBreakStartAt] = useState(null);
  const [breakExceededMarker, setBreakExceededMarker] = useState("");
  const [clockTick, setClockTick] = useState(Date.now());

  const employeeList = useMemo(() => employees.filter((emp) => !isManager(emp.role)), []);
  const selectedEmployee = useMemo(() => employeeList.find((emp) => emp.id === taskForm.assignedTo), [employeeList, taskForm.assignedTo]);
  const unreadCount = useMemo(() => notifications.filter((note) => !note.read).length, [notifications]);
  const filteredNotifications = useMemo(
    () => notifications.filter((note) => (notificationFilter === "unread" ? !note.read : true)),
    [notificationFilter, notifications]
  );
  const filteredTaskRows = useMemo(() => {
    return taskRows.filter((row) => {
      const matchesSearch = !taskSearch.trim()
        || String(row.title || "").toLowerCase().includes(taskSearch.trim().toLowerCase())
        || String(row.details || "").toLowerCase().includes(taskSearch.trim().toLowerCase());
      const matchesStatus = taskStatusFilter === "all" || row.status === taskStatusFilter;
      const matchesPriority = taskPriorityFilter === "all" || row.priority === taskPriorityFilter;
      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [taskPriorityFilter, taskRows, taskSearch, taskStatusFilter]);
  const taskSummaryStats = useMemo(() => ({
    assigned: taskRows.filter((row) => row.status === "assigned").length,
    inProgress: taskRows.filter((row) => row.status === "in_progress").length,
    completed: taskRows.filter((row) => row.status === "completed").length,
  }), [taskRows]);
  const highPriorityBlockingTasks = useMemo(() => {
    if (role !== "employee") return [];
    return taskRows
      .filter((row) => String(row.priority || "").toLowerCase() === "high" && !["completed", "cancelled"].includes(row.status))
      .sort((a, b) => {
        const aTime = a.createdAtDate?.getTime?.() || 0;
        const bTime = b.createdAtDate?.getTime?.() || 0;
        return bTime - aTime;
      });
  }, [role, taskRows]);
  const lockedTask = useMemo(() => {
    if (!highPriorityBlockingTasks.length) return null;
    return highPriorityBlockingTasks.find((row) => row.id === lockedTaskId) || highPriorityBlockingTasks[0];
  }, [highPriorityBlockingTasks, lockedTaskId]);
  const miniCalendarMonthLabel = useMemo(
    () => miniCalendarDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    [miniCalendarDate]
  );
  const personalLeaveRows = useMemo(
    () => leaveRows.filter((row) => row.employeeId === user?.id),
    [leaveRows, user?.id]
  );
  const saturdayHolidaySet = useMemo(() => new Set(saturdayHolidayDates), [saturdayHolidayDates]);

  const leaveStatusByDate = useMemo(() => {
    const priority = { approved: 3, pending: 2, rejected: 1 };
    const map = new Map();

    personalLeaveRows.forEach((row) => {
      if (row.status === "cancelled") return;
      if (row.status === "rejected") return;
      const from = new Date(row.fromDateValue || row.fromDate || "");
      const to = new Date(row.toDateValue || row.toDate || "");
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return;

      const normalizedStatus = row.status === "approved"
        ? "approved"
        : "pending";

      for (let dt = new Date(from); dt <= to; dt.setDate(dt.getDate() + 1)) {
        const key = dt.toISOString().slice(0, 10);
        const existing = map.get(key);
        if (!existing || priority[normalizedStatus] >= priority[existing.status]) {
          map.set(key, {
            status: normalizedStatus,
            reason: row.reason || "",
          });
        }
      }
    });

    return map;
  }, [personalLeaveRows]);

  const miniCalendarCells = useMemo(() => {
    const year = miniCalendarDate.getFullYear();
    const monthIndex = miniCalendarDate.getMonth();
    const firstDayOfWeek = new Date(year, monthIndex, 1).getDay();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const today = new Date();
    const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());

    const cells = [];
    for (let i = 0; i < firstDayOfWeek; i += 1) cells.push(null);

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = toDateKey(year, monthIndex, day);
      const dayOfWeek = new Date(year, monthIndex, day).getDay();
      const isSunday = dayOfWeek === 0;
      const isSaturday = dayOfWeek === 6;
      const holidayName =
        HOLIDAY_MAP[dateKey] ||
        (isSunday ? "Sunday" : "") ||
        (isSaturday && saturdayHolidaySet.has(dateKey) ? "Saturday Off" : "");
      const leaveInfo = leaveStatusByDate.get(dateKey) || null;
      cells.push({
        day,
        dateKey,
        isWeekend: isSunday,
        holidayName,
        leaveStatus: leaveInfo?.status || "",
        leaveReason: leaveInfo?.reason || "",
        isToday: dateKey === todayKey,
      });
    }

    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [leaveStatusByDate, miniCalendarDate, saturdayHolidaySet]);
  const miniMonthHolidays = useMemo(() => {
    const year = miniCalendarDate.getFullYear();
    const monthIndex = miniCalendarDate.getMonth();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const rows = [];

    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = toDateKey(year, monthIndex, day);
      const dayOfWeek = new Date(year, monthIndex, day).getDay();
      if (HOLIDAY_MAP[key]) {
        rows.push({ key, name: HOLIDAY_MAP[key], day });
        continue;
      }
      if (dayOfWeek === 0) {
        rows.push({ key, name: "Sunday", day });
        continue;
      }
      if (dayOfWeek === 6 && saturdayHolidaySet.has(key)) {
        rows.push({ key, name: "Saturday Off", day });
      }
    }

    return rows.sort((a, b) => a.day - b.day);
  }, [miniCalendarDate, saturdayHolidaySet]);

  const refresh = () => setRefreshToken((prev) => prev + 1);
  const isLoading = (action) => busy && loadingAction === action;
  const setFlash = (text) => {
    setMessage(text);
    setTimeout(() => setMessage(""), 3500);
  };

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    const saved = localStorage.getItem(`portal_shift_${user.id}`);
    const savedStartAt = localStorage.getItem(`portal_shift_started_at_${user.id}`);
    const savedBreak = localStorage.getItem(`portal_break_${user.id}`);
    const savedBreakStartAt = localStorage.getItem(`portal_break_started_at_${user.id}`);
    const savedBreakExceededMarker = localStorage.getItem(`portal_break_exceeded_${user.id}`);
    setShiftRunning(saved === "running");
    setShiftStartAt(savedStartAt ? Number(savedStartAt) : null);
    setActiveBreakType(savedBreak || "");
    setBreakStartAt(savedBreakStartAt ? Number(savedBreakStartAt) : null);
    setBreakExceededMarker(savedBreakExceededMarker || "");
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    const interval = setInterval(() => setClockTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const loadData = async () => {
      const [noti, leaves, tasks, worksheets, counts, attendance, breaks, settings] = await Promise.all([
        fetchNotifications({ recipientId: user.id, role }),
        fetchLeaveRequests(role === "manager" ? {} : { employeeId: user.id }),
        fetchTasks(role === "manager" ? {} : { assignedTo: user.id }),
        fetchWorksheets(role === "manager" ? {} : { employeeId: user.id }),
        role === "manager" ? fetchPendingCounts() : Promise.resolve({ leaves: 0, worksheets: 0 }),
        fetchAllAttendanceData(),
        fetchAllBreaksData(),
        fetchPortalSettings(),
      ]);

      setNotifications(noti.slice(0, 10));
      setLeaveRows(leaves);
      setTaskRows(tasks);
      setWorksheetRows(worksheets);
      setPendingCounts(counts);
      setAttendanceRaw(attendance);
      setBreakRows(breaks);
      setSaturdayHolidayDates(settings?.saturdayHolidays || []);
    };

    loadData().catch((error) => {
      console.error(error);
      setFlash("Failed to load portal data.");
    });
  }, [isAuthenticated, user?.id, role, refreshToken]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return undefined;

    const interval = setInterval(() => {
      setRefreshToken((prev) => prev + 1);
    }, AUTO_SYNC_MS);

    return () => clearInterval(interval);
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (role !== "employee") {
      setLockedTaskId("");
      return;
    }
    if (!highPriorityBlockingTasks.length) {
      setLockedTaskId("");
      return;
    }
    if (!lockedTaskId || !highPriorityBlockingTasks.some((row) => row.id === lockedTaskId)) {
      setLockedTaskId(highPriorityBlockingTasks[0].id);
    }
  }, [highPriorityBlockingTasks, lockedTaskId, role]);

  useEffect(() => {
    if (!isAuthenticated) {
      employeeDefaultTabAppliedRef.current = false;
      return;
    }
    if (role === "employee" && !employeeDefaultTabAppliedRef.current) {
      setActiveTab("dashboard");
      employeeDefaultTabAppliedRef.current = true;
    }
  }, [isAuthenticated, role, user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedTheme = localStorage.getItem("portal_theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    const initialTheme = savedTheme || (prefersDark ? "dark" : "light");
    setTheme(initialTheme);
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("portal_theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!isAuthenticated || role !== "manager") return undefined;

    const pollLiveBreaks = async () => {
      try {
        const latestBreaks = await fetchAllBreaksData();
        setBreakRows(latestBreaks);
      } catch (error) {
        console.error(error);
      }
    };

    pollLiveBreaks();
    const interval = setInterval(pollLiveBreaks, LIVE_BREAK_POLL_MS);
    return () => clearInterval(interval);
  }, [isAuthenticated, role]);

  useEffect(() => {
    if (!showNotifications) return;

    const onPointerDown = (event) => {
      if (!notificationsRef.current?.contains(event.target)) {
        setShowNotifications(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showNotifications]);

  useEffect(() => {
    if (!isAuthenticated || role !== "manager") return;

    const [year, month] = monthFilter.split("-");
    fetchMonthlyAttendanceSummary({ year, month, employees: employeeList })
      .then(setMonthlySummary)
      .catch((error) => {
        console.error(error);
        setFlash("Could not load monthly summary.");
      });
  }, [employeeList, isAuthenticated, monthFilter, role, refreshToken]);

  const leaveConflicts = useMemo(() => {
    const bucket = {};
    leaveRows.filter((row) => row.status === "approved").forEach((row) => {
      const from = new Date(row.fromDateValue);
      const to = new Date(row.toDateValue);
      for (let dt = new Date(from); dt <= to; dt.setDate(dt.getDate() + 1)) {
        const key = dt.toISOString().slice(0, 10);
        bucket[key] = (bucket[key] || 0) + 1;
      }
    });

    return Object.entries(bucket)
      .filter(([, count]) => count >= 2)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [leaveRows]);

  const heatmap = useMemo(() => {
    const dates = [];
    const today = new Date();
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const attendanceMap = new Map();
    attendanceRaw.forEach((row) => {
      if (row.action !== "clock-in") return;
      const date = row.date || (row.timestamp instanceof Date ? row.timestamp.toISOString().slice(0, 10) : "");
      attendanceMap.set(`${row.empId}-${date}`, true);
    });

    return {
      dates,
      rows: employeeList.map((emp) => ({
        employeeId: emp.id,
        name: emp.name,
        cells: dates.map((date) => Boolean(attendanceMap.get(`${emp.id}-${date}`))),
      })),
    };
  }, [attendanceRaw, employeeList]);

  const todayAttendanceRows = useMemo(() => {
    const today = getToday();
    return attendanceRaw
      .filter((row) => (row.date || "").slice(0, 10) === today)
      .sort((a, b) => {
        const aTime = rowTime(a);
        const bTime = rowTime(b);
        return bTime - aTime;
      });
  }, [attendanceRaw]);

  const myAttendanceRows = useMemo(
    () => todayAttendanceRows.filter((row) => row.empId === user?.id),
    [todayAttendanceRows, user?.id]
  );
  const detailedActivityRows = useMemo(() => {
    const attendanceEvents = attendanceRaw.map((row) => {
      const timestamp = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp || Date.now());
      const dateKey = (row.date || (timestamp instanceof Date ? timestamp.toISOString().slice(0, 10) : "")).slice(0, 10);
      return {
        employeeId: row.empId || row.employeeId || "-",
        employeeName: row.empName || row.employeeName || "-",
        eventType: "attendance",
        action: row.action || "-",
        breakType: "",
        dateKey,
        displayDate: formatDate(dateKey),
        displayTime: row.time || new Date(timestamp).toLocaleTimeString("en-IN"),
        timestamp,
      };
    });

    const breakEvents = breakRows.map((row) => {
      const timestamp = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp || Date.now());
      const rawAction = String(row.action || "").toLowerCase();
      const inferredAction = rawAction || (String(row.status || "").toLowerCase() === "active" ? "start" : "end");
      const dateKey = (row.date || (timestamp instanceof Date ? timestamp.toISOString().slice(0, 10) : "")).slice(0, 10);
      return {
        employeeId: row.employeeId || row.empId || "-",
        employeeName: row.employeeName || row.empName || "-",
        eventType: "break",
        action: inferredAction === "start" ? "break-start" : "break-end",
        breakType: row.breakType || "-",
        dateKey,
        displayDate: formatDate(dateKey),
        displayTime: row.time || new Date(timestamp).toLocaleTimeString("en-IN"),
        timestamp,
      };
    });

    return [...attendanceEvents, ...breakEvents].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [attendanceRaw, breakRows]);

  const filteredDetailedActivityRows = useMemo(() => {
    return detailedActivityRows.filter((row) => {
      if (activityEmployeeFilter !== "all" && row.employeeId !== activityEmployeeFilter) return false;
      if (activityExportMode === "day") return row.dateKey === activityExportDay;
      return row.dateKey.startsWith(`${activityExportMonth}-`);
    });
  }, [activityEmployeeFilter, activityExportDay, activityExportMode, activityExportMonth, detailedActivityRows]);
  const liveBreakRows = useMemo(() => {
    const today = getToday();
    const todayBreaks = breakRows
      .filter((row) => {
        const ts = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp || Date.now());
        if (Number.isNaN(ts.getTime())) return false;
        const rowDateFromField = String(row.date || "").slice(0, 10);
        const rowDateFromTs = ts.toISOString().slice(0, 10);
        return rowDateFromField === today || rowDateFromTs === today;
      })
      .sort((a, b) => {
        const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp || 0).getTime();
        const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp || 0).getTime();
        return bTime - aTime;
      });

    const latestByEmployee = new Map();
    todayBreaks.forEach((row) => {
      const key = row.employeeId || row.empId || row.employeeName || "unknown";
      if (!latestByEmployee.has(key)) latestByEmployee.set(key, row);
    });

    return Array.from(latestByEmployee.values()).filter((row) => String(row.status || "").toLowerCase() === "active");
  }, [breakRows]);
  const saveShiftState = (running, startedAt = null) => {
    localStorage.setItem(`portal_shift_${user.id}`, running ? "running" : "stopped");
    setShiftRunning(running);
    if (running && startedAt) {
      localStorage.setItem(`portal_shift_started_at_${user.id}`, String(startedAt));
      setShiftStartAt(startedAt);
      return;
    }
    localStorage.removeItem(`portal_shift_started_at_${user.id}`);
    setShiftStartAt(null);
  };

  const saveBreakState = (breakType, startedAt = null) => {
    if (breakType) {
      localStorage.setItem(`portal_break_${user.id}`, breakType);
      if (startedAt) {
        localStorage.setItem(`portal_break_started_at_${user.id}`, String(startedAt));
        setBreakStartAt(startedAt);
      }
      localStorage.removeItem(`portal_break_exceeded_${user.id}`);
      setBreakExceededMarker("");
    } else {
      localStorage.removeItem(`portal_break_${user.id}`);
      localStorage.removeItem(`portal_break_started_at_${user.id}`);
      localStorage.removeItem(`portal_break_exceeded_${user.id}`);
      setBreakStartAt(null);
      setBreakExceededMarker("");
    }
    setActiveBreakType(breakType);
  };

  const handleStartShift = async () => {
    if (shiftRunning) return setFlash("Shift already running.");
    setBusy(true);
    setLoadingAction("start-shift");
    try {
      const now = new Date();
      const shiftStartToday = new Date(now);
      shiftStartToday.setHours(SHIFT_START_HOUR, 0, 0, 0);
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: user.id,
          employeeName: user.name,
          action: "clock-in",
          shift: FIXED_SHIFT_LABEL,
          isLate: now.getTime() > shiftStartToday.getTime(),
        }),
      });
      if (!response.ok) throw new Error("Failed to start shift");
      saveShiftState(true, Date.now());
      setFlash("Shift started.");
      refresh();
    } catch (error) {
      console.error(error);
      setFlash("Could not start shift.");
    } finally {
      setBusy(false);
      setLoadingAction("");
    }
  };

  const handleEndShift = async () => {
    if (!shiftRunning) return setFlash("No active shift.");
    setBusy(true);
    setLoadingAction("end-shift");
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: user.id,
          employeeName: user.name,
          action: "clock-out",
          shift: FIXED_SHIFT_LABEL,
          isLate: false,
        }),
      });
      if (!response.ok) throw new Error("Failed to end shift");
      saveShiftState(false);
      saveBreakState("");
      setFlash("Shift ended.");
      refresh();
    } catch (error) {
      console.error(error);
      setFlash("Could not end shift.");
    } finally {
      setBusy(false);
      setLoadingAction("");
    }
  };

  const handleBreak = async (breakType, action) => {
    if (!shiftRunning) return setFlash("Start shift before break.");
    setBusy(true);
    setLoadingAction(`break-${breakType}-${action}`);
    try {
      const response = await fetch("/api/breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: user.id,
          employeeName: user.name,
          breakType,
          action,
        }),
      });
      if (!response.ok) throw new Error("Break update failed");
      if (action === "start") saveBreakState(breakType, Date.now());
      if (action === "end") saveBreakState("");
      setFlash(`${breakType} break ${action}ed.`);
      refresh();
    } catch (error) {
      console.error(error);
      setFlash("Could not update break.");
    } finally {
      setBusy(false);
      setLoadingAction("");
    }
  };

  const handleSubmitLeave = async (event) => {
    event.preventDefault();
    if (!leaveForm.fromDate || !leaveForm.toDate || !leaveForm.reason) return setFlash("Please fill all leave fields.");

    setBusy(true);
    setLoadingAction("submit-leave");
    try {
      const from = new Date(leaveForm.fromDate);
      const to = new Date(leaveForm.toDate);
      const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
      await submitLeaveRequest({ employeeId: user.id, employeeName: user.name, employeeEmail: user.email, department: user.department, ...leaveForm, days: Math.max(1, days) });
      setLeaveForm({ fromDate: "", toDate: "", reason: "", leaveType: "General" });
      setFlash("Leave request submitted.");
      refresh();
    } catch (error) {
      console.error(error);
      setFlash("Failed to submit leave request.");
    } finally {
      setBusy(false);
      setLoadingAction("");
    }
  };

  const handleAssignTask = async (event) => {
    event.preventDefault();
    if (!taskForm.title || !taskForm.assignedTo) return setFlash("Task title and assignee are required.");

    setBusy(true);
    setLoadingAction("assign-task");
    try {
      await createTask({ ...taskForm, assignedToName: selectedEmployee?.name || taskForm.assignedTo, assignedBy: user.id, assignedByName: user.name });
      setTaskForm({ title: "", details: "", assignedTo: "", priority: "medium", dueDate: "" });
      setFlash("Task assigned.");
      refresh();
    } catch (error) {
      console.error(error);
      setFlash("Could not assign task.");
    } finally {
      setBusy(false);
      setLoadingAction("");
    }
  };

  useEffect(() => {
    if (!isAuthenticated || role !== "employee" || !user?.id) return;
    if (!shiftRunning || busy) return;

    const now = new Date(clockTick);
    const cutoff = new Date(now);
    cutoff.setHours(19, 30, 0, 0);
    if (now.getTime() < cutoff.getTime()) return;

    const dateKey = now.toISOString().slice(0, 10);
    if (autoShiftCloseKeyRef.current === dateKey) return;
    autoShiftCloseKeyRef.current = dateKey;

    const autoEndShift = async () => {
      setBusy(true);
      setLoadingAction("end-shift-auto");
      try {
        const response = await fetch("/api/attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: user.id,
            employeeName: user.name,
            action: "clock-out",
            shift: FIXED_SHIFT_LABEL,
            isLate: false,
          }),
        });
        if (!response.ok) throw new Error("Failed to auto end shift");
        saveShiftState(false);
        saveBreakState("");
        setFlash("Shift auto-ended at 7:30 PM.");
        refresh();
      } catch (error) {
        console.error(error);
        autoShiftCloseKeyRef.current = "";
        setFlash("Could not auto end shift.");
      } finally {
        setBusy(false);
        setLoadingAction("");
      }
    };

    autoEndShift();
  }, [busy, clockTick, isAuthenticated, role, shiftRunning, user?.id, user?.name]);

  const handleManagerSetHalfDayLeave = async (event) => {
    event.preventDefault();
    if (role !== "manager") return;
    if (!managerHalfDayForm.employeeId || !managerHalfDayForm.date || !managerHalfDayForm.reason) {
      return setFlash("Employee, date, and reason are required for half day leave.");
    }

    setBusy(true);
    setLoadingAction("manager-half-day");
    try {
      await assignHalfDayLeaveByManager({
        employeeId: managerHalfDayForm.employeeId,
        date: managerHalfDayForm.date,
        reason: managerHalfDayForm.reason,
        managerId: user.id,
        managerName: user.name,
      });
      setManagerHalfDayForm({ employeeId: "", date: getToday(), reason: "Late arrival" });
      setFlash("Half day leave assigned.");
      refresh();
    } catch (error) {
      console.error(error);
      setFlash("Could not assign half day leave.");
    } finally {
      setBusy(false);
      setLoadingAction("");
    }
  };

  const handleSaturdayHolidayUpdate = async (isHoliday) => {
    if (role !== "manager") return;
    if (!saturdayHolidayDate) return setFlash("Please select a date.");
    const dayOfWeek = new Date(saturdayHolidayDate).getDay();
    if (dayOfWeek !== 6) return setFlash("Please select a Saturday date.");

    setBusy(true);
    setLoadingAction(isHoliday ? "saturday-holiday-add" : "saturday-holiday-remove");
    try {
      const next = await setSaturdayHoliday({
        date: saturdayHolidayDate,
        isHoliday,
        managerId: user.id,
        managerName: user.name,
      });
      setSaturdayHolidayDates(next);
      setFlash(isHoliday ? "Saturday marked as holiday." : "Saturday holiday removed.");
    } catch (error) {
      console.error(error);
      setFlash("Could not update Saturday holiday.");
    } finally {
      setBusy(false);
      setLoadingAction("");
    }
  };

  const handleLockedTaskComplete = async () => {
    if (!lockedTask?.id) return;
    setBusy(true);
    setLoadingAction(`task-${lockedTask.id}-completed`);
    try {
      await updateTaskStatus({ taskId: lockedTask.id, status: "completed", actorId: user.id, actorName: user.name });
      setFlash("High priority task completed. Access unlocked.");
      refresh();
    } catch (error) {
      console.error(error);
      setFlash("Could not complete high priority task.");
    } finally {
      setBusy(false);
      setLoadingAction("");
    }
  };

  const handleWorksheetSubmit = async (event) => {
    event.preventDefault();
    if (!worksheetForm.date || !worksheetForm.taskSummary) return setFlash("Date and summary are required.");

    setBusy(true);
    setLoadingAction("submit-worksheet");
    try {
      await upsertWorksheet({ employeeId: user.id, employeeName: user.name, date: worksheetForm.date, taskSummary: worksheetForm.taskSummary, hoursWorked: 0, blockers: worksheetForm.blockers, status: "submitted" });
      setWorksheetForm({ date: getToday(), taskSummary: "", blockers: "" });
      setFlash("Worksheet submitted.");
      refresh();
    } catch (error) {
      console.error(error);
      setFlash("Failed to submit worksheet.");
    } finally {
      setBusy(false);
      setLoadingAction("");
    }
  };

  const exportAttendanceExcel = () => {
    if (!monthlySummary.length) return setFlash("No summary data available.");
    const exportRows = monthlySummary.map((row) => ({
      Employee: row.employeeName,
      PresentDays: row.presentDays,
      HalfDays: row.halfDays || 0,
      PayableDays: row.payableDays ?? row.presentDays,
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Monthly Summary");
    XLSX.writeFile(workbook, `attendance-summary-${monthFilter}.xlsx`);
  };

  const exportAttendancePdf = () => {
    if (!monthlySummary.length) return setFlash("No summary data available.");
    const rows = monthlySummary
      .map((row) => `<tr><td>${row.employeeName}</td><td>${row.presentDays}</td><td>${row.halfDays || 0}</td><td>${row.payableDays ?? row.presentDays}</td></tr>`)
      .join("");
    const win = window.open("", "_blank");
    if (!win) return setFlash("Please allow popups for PDF export.");
    win.document.write(`<html><body><h2>Attendance Summary (${monthFilter})</h2><table border="1" cellpadding="8"><tr><th>Employee</th><th>Present Days</th><th>Half Days</th><th>Payable Days</th></tr>${rows}</table><script>window.print();</script></body></html>`);
    win.document.close();
  };

  const exportWorksheetExcel = () => {
    const filteredRows = worksheetRows.filter((row) => {
      const rowDate = (row.date || "").slice(0, 10);
      if (!rowDate) return false;
      return worksheetExportMode === "day"
        ? rowDate === worksheetExportDay
        : rowDate.startsWith(`${worksheetExportMonth}-`);
    });

    if (!filteredRows.length) {
      return setFlash(
        worksheetExportMode === "day"
          ? "No worksheet records found for selected day."
          : "No worksheet records found for selected month."
      );
    }

    const exportRows = filteredRows.map((row, index) => ({
      SrNo: index + 1,
      EmployeeName: row.employeeName || row.employeeId || "-",
      Date: row.date || "-",
      WorkSummary: row.taskSummary || "-",
      Blockers: row.blockers || "-",
      Status: row.status || "-",
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Worksheets");
    const suffix = worksheetExportMode === "day" ? worksheetExportDay : worksheetExportMonth;
    XLSX.writeFile(workbook, `worksheets-${worksheetExportMode}-${suffix}.xlsx`);
  };

  const exportDetailedActivityExcel = () => {
    if (!filteredDetailedActivityRows.length) {
      return setFlash("No activity records found for selected filters.");
    }

    const exportRows = filteredDetailedActivityRows.map((row, index) => ({
      SrNo: index + 1,
      EmployeeID: row.employeeId,
      EmployeeName: row.employeeName,
      EventType: row.eventType,
      Action: row.action,
      BreakType: row.breakType || "-",
      Date: row.dateKey,
      Time: row.displayTime,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Detailed Activity");
    const suffix = activityExportMode === "day" ? activityExportDay : activityExportMonth;
    XLSX.writeFile(workbook, `attendance-break-report-${suffix}.xlsx`);
  };

  const handleNotificationClick = async (note) => {
    if (!note?.id || note.read) return;
    setNotifications((prev) => prev.map((item) => (item.id === note.id ? { ...item, read: true } : item)));
    try {
      await markNotificationRead(note.id);
    } catch (error) {
      console.error(error);
      setNotifications((prev) => prev.map((item) => (item.id === note.id ? { ...item, read: false } : item)));
      setFlash("Could not mark notification as read.");
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    if (!unreadCount || notificationsBusy) return;
    setNotificationsBusy(true);
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
    try {
      await markAllNotificationsRead({ recipientId: user.id, role });
      setFlash("All notifications marked as read.");
    } catch (error) {
      console.error(error);
      refresh();
      setFlash("Could not update notifications.");
    } finally {
      setNotificationsBusy(false);
    }
  };

  const shiftElapsedMs = shiftRunning && shiftStartAt ? Math.max(0, clockTick - shiftStartAt) : 0;
  const breakTargetMinutes = BREAK_TARGET_MINUTES[activeBreakType] || 15;
  const breakElapsedMs = activeBreakType && breakStartAt ? Math.max(0, clockTick - breakStartAt) : 0;
  const breakProgress = activeBreakType ? Math.min(100, (breakElapsedMs / (breakTargetMinutes * 60000)) * 100) : 0;
  const isBreakOverrun = activeBreakType && breakElapsedMs > breakTargetMinutes * 60000;
  const breakRemainingMs = Math.max(0, breakTargetMinutes * 60000 - breakElapsedMs);

  useEffect(() => {
    if (!isAuthenticated || role !== "employee") return;
    if (!activeBreakType || !breakStartAt || !isBreakOverrun) return;

    const marker = `${activeBreakType}-${breakStartAt}`;
    if (breakExceededMarker === marker) return;

    const exceededMinutes = Math.max(1, Math.floor((breakElapsedMs - breakTargetMinutes * 60000) / 60000));
    setBreakExceededMarker(marker);
    localStorage.setItem(`portal_break_exceeded_${user.id}`, marker);

    const notifyExceededBreak = async () => {
      try {
        await Promise.all([
          createNotification({
            recipientRole: "manager",
            title: "Break limit exceeded",
            message: `${user.name} exceeded ${activeBreakType} break by ${exceededMinutes} minute(s).`,
            type: "break",
            meta: { employeeId: user.id, breakType: activeBreakType, exceededMinutes },
          }),
          createNotification({
            recipientId: user.id,
            title: "Break limit exceeded",
            message: `You exceeded ${activeBreakType} break by ${exceededMinutes} minute(s).`,
            type: "break",
            meta: { employeeId: user.id, breakType: activeBreakType, exceededMinutes },
          }),
        ]);
      } catch (error) {
        console.error(error);
      }
    };

    notifyExceededBreak();
  }, [
    activeBreakType,
    breakElapsedMs,
    breakExceededMarker,
    breakStartAt,
    breakTargetMinutes,
    isAuthenticated,
    isBreakOverrun,
    role,
    user?.id,
    user?.name,
  ]);

  if (loading) return <div className="p-8 text-center text-slate-600 dark:text-white">Loading portal...</div>;
  if (!isAuthenticated) return <Login />;

  const getNotificationMeta = (type) => notificationMeta[type] || notificationMeta.info;
  const profileFields = [
    { label: "Employee ID", value: user?.id || "-" },
    { label: "Role", value: formatRoleLabel(role) },
    { label: "Email", value: user?.email || "-" },
    { label: "Phone", value: user?.phone || "-" },
    { label: "Department", value: user?.department || "-" },
    { label: "Shift", value: user?.shift || FIXED_SHIFT_LABEL },
    { label: "Date of Joining", value: user?.dateOfJoining ? formatDate(user.dateOfJoining) : "-" },
  ];

  const tabs = role === "manager"
    ? ["dashboard", "profile", "leave", "tasks", "worksheets", "calendar", "exports"]
    : ["dashboard", "profile", "leave", "tasks", "worksheets"];

  return (
    <div className={`min-h-screen ${theme === "dark" ? "bg-[radial-gradient(circle_at_top,_#312e81_0%,_#111827_42%,_#020617_100%)]" : "bg-[radial-gradient(circle_at_top,_#e0ecff_0%,_#f8fafc_35%,_#f8fafc_100%)]"}`}>
      {lockedTask ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-red-500/40 bg-slate-900 p-5 shadow-2xl">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-red-300">Priority Lock</p>
            <h2 className="text-xl font-bold text-white">Complete high priority task to continue</h2>
            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
              <p className="text-base font-semibold text-white">{lockedTask.title}</p>
              <p className="mt-1 text-sm text-slate-300">{lockedTask.details || "No task details provided."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs font-medium text-white">High Priority</span>
                <span className="rounded bg-slate-700/40 px-2 py-0.5 text-xs font-medium text-white">Status: {lockedTask.status}</span>
                <span className="rounded bg-slate-700/40 px-2 py-0.5 text-xs font-medium text-white">Due: {lockedTask.dueDate ? formatDate(lockedTask.dueDate) : "Not set"}</span>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-300">Other portal sections are blocked until this task is marked completed.</p>
            <button
              type="button"
              onClick={handleLockedTaskComplete}
              disabled={busy}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-500 bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
            >
              {busy && loadingAction === `task-${lockedTask.id}-completed` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy && loadingAction === `task-${lockedTask.id}-completed` ? "Completing..." : "Mark as Completed"}
            </button>
          </div>
        </div>
      ) : null}
      <header className={`sticky top-0 z-20 border-b backdrop-blur ${theme === "dark" ? "border-violet-900/70 bg-[#0d1020]/85" : "border-slate-200/80 bg-white/85"}`}>
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className={`text-xs font-medium uppercase tracking-[0.2em] ${theme === "dark" ? "text-white" : "text-slate-500"}`}>Employee Management Portal</p>
            <h1 className={`truncate text-lg font-semibold sm:text-xl ${theme === "dark" ? "text-white" : "text-slate-900"}`}>{user.name} ({formatRoleLabel(role)})</h1>
          </div>
          <div ref={notificationsRef} className="relative flex items-center justify-end gap-2">
            <button
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              className={`inline-flex h-10 items-center justify-center gap-1 rounded-lg border px-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm ${theme === "dark" ? "border-violet-700/60 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="text-xs font-medium">{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
            <button
              onClick={() => setShowNotifications((prev) => !prev)}
              className={`relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm ${theme === "dark" ? "border-violet-700/60 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
              aria-label="Toggle notifications"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </button>
            <button onClick={logout} className={btnSecondary}>Logout</button>

            {showNotifications ? (
              <div className={`absolute right-0 top-12 z-30 w-[min(94vw,380px)] rounded-xl border p-0 shadow-xl ${theme === "dark" ? "border-violet-900/70 bg-[#111427]" : "border-slate-200 bg-white"}`}>
                <div className={`border-b p-3 ${theme === "dark" ? "border-violet-900/70" : "border-slate-200"}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>Notifications</p>
                    <button
                      onClick={handleMarkAllNotificationsRead}
                      disabled={!unreadCount || notificationsBusy}
                      className={btnTinyPrimary}
                    >
                      {notificationsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                      Mark all read
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className={`text-xs ${theme === "dark" ? "text-white" : "text-slate-500"}`}>{unreadCount} unread</div>
                    <div className={`rounded-md border p-0.5 ${theme === "dark" ? "border-violet-900/70 bg-slate-900/60" : "border-slate-200"}`}>
                    <button
                      onClick={() => setNotificationFilter("all")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${notificationFilter === "all" ? (theme === "dark" ? "bg-violet-600 text-white shadow-sm" : "bg-slate-900 text-white shadow-sm") : (theme === "dark" ? "text-white" : "text-slate-600 hover:bg-slate-100")}`}
                    >
                        All
                      </button>
                    <button
                      onClick={() => setNotificationFilter("unread")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${notificationFilter === "unread" ? (theme === "dark" ? "bg-violet-600 text-white shadow-sm" : "bg-slate-900 text-white shadow-sm") : (theme === "dark" ? "text-white" : "text-slate-600 hover:bg-slate-100")}`}
                    >
                        Unread
                      </button>
                    </div>
                  </div>
                </div>
                <div className="max-h-96 space-y-2 overflow-y-auto p-3">
                  {filteredNotifications.length ? filteredNotifications.map((note) => (
                    (() => {
                      const meta = getNotificationMeta(note.type);
                      const TypeIcon = meta.icon;
                      return (
                        <button
                          key={note.id}
                          onClick={() => handleNotificationClick(note)}
                          className={`w-full cursor-pointer rounded-lg border p-3 text-left transition ${
                            note.read ? (theme === "dark" ? "border-slate-800 bg-slate-900/60" : "border-slate-200 bg-white") : (theme === "dark" ? "border-violet-700/60 bg-violet-500/10" : "border-blue-200 bg-blue-50/70")
                          }`}
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.tone}`}>
                                <TypeIcon className="h-4 w-4" />
                              </span>
                              <div className="min-w-0">
                                <p className={`truncate text-sm font-semibold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>{note.title}</p>
                                <p className={`text-[11px] ${theme === "dark" ? "text-white" : "text-slate-500"}`}>{meta.label}</p>
                              </div>
                            </div>
                            {!note.read ? <Dot className="h-6 w-6 shrink-0 text-violet-300" /> : null}
                          </div>
                          <p className={`mb-2 text-xs ${theme === "dark" ? "text-white" : "text-slate-700"}`}>{note.message}</p>
                          <p className={`text-[11px] ${theme === "dark" ? "text-white" : "text-slate-500"}`}>{formatTimeAgo(note.createdAtDate || note.createdAt || note.updatedAtDate)}</p>
                        </button>
                      );
                    })()
                  )) : (
                    <div className={`rounded-lg border border-dashed p-6 text-center ${theme === "dark" ? "border-slate-700" : "border-slate-200"}`}>
                      <p className={`text-sm font-medium ${theme === "dark" ? "text-white" : "text-slate-700"}`}>No notifications</p>
                      <p className={`text-xs ${theme === "dark" ? "text-white" : "text-slate-500"}`}>You are all caught up.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-3 py-4 sm:px-4 sm:py-5 lg:grid-cols-[250px_1fr]">
        <aside className={`h-fit rounded-2xl border p-3 shadow-sm backdrop-blur lg:sticky lg:top-24 ${theme === "dark" ? "border-violet-900/60 bg-[#111427]/90" : "border-slate-200/80 bg-white/90"}`}>
          <p className={`mb-2 text-xs font-semibold uppercase tracking-[0.18em] ${theme === "dark" ? "text-white" : "text-slate-500"}`}>Modules</p>
          <div className="space-y-1.5">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition ${
                  activeTab === tab ? (theme === "dark" ? "bg-violet-600 text-white shadow-sm" : "bg-slate-900 text-white shadow-sm") : (theme === "dark" ? "text-white" : "text-slate-700 hover:bg-slate-100")
                }`}
              >
                <span className="flex items-center gap-2">
                  {(() => {
                    const Icon = tabMeta[tab]?.icon || SunMedium;
                    return <Icon className="h-4 w-4" />;
                  })()}
                  {tabMeta[tab]?.label || tab}
                </span>
              </button>
            ))}
          </div>

          <div className={`mt-4 rounded-xl border p-3 ${theme === "dark" ? "border-violet-700/40 bg-[#0b1230]/70" : "border-slate-200 bg-slate-50/80"}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className={`text-xs font-semibold uppercase tracking-wide ${theme === "dark" ? "text-slate-100" : "text-slate-600"}`}>Calendar</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMiniCalendarDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                  className={`inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md ${theme === "dark" ? "text-slate-200 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-200"}`}
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setMiniCalendarDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                  className={`inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md ${theme === "dark" ? "text-slate-200 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-200"}`}
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <p className={`mb-2 text-xs font-medium ${theme === "dark" ? "text-slate-200" : "text-slate-700"}`}>{miniCalendarMonthLabel}</p>
            <div className="mb-1 grid grid-cols-7 gap-1">
              {WEEKDAY_LABELS.map((label, index) => (
                <div key={`${label}-${index}`} className={`text-center text-[10px] font-semibold ${index === 0 || index === 6 ? (theme === "dark" ? "text-rose-300" : "text-red-600") : (theme === "dark" ? "text-slate-400" : "text-slate-500")}`}>
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {miniCalendarCells.map((cell, idx) => (
                <div
                  key={`mini-cell-${idx}`}
                  className={`flex h-7 items-center justify-center rounded-md text-[11px] ${
                    !cell
                      ? "text-transparent"
                      : theme === "dark"
                        ? cell.leaveStatus === "approved"
                          ? "bg-emerald-500/25 font-semibold text-emerald-200"
                          : cell.leaveStatus === "pending"
                            ? "bg-amber-500/25 font-semibold text-amber-200"
                            : cell.leaveStatus === "rejected"
                              ? "bg-rose-500/25 font-semibold text-rose-200"
                              : cell.holidayName
                                ? "bg-violet-500/25 font-semibold text-violet-200"
                                : cell.isWeekend
                                  ? "bg-slate-800/70 text-slate-300"
                                  : "bg-slate-900/40 text-slate-300"
                        : cell.leaveStatus === "approved"
                          ? "bg-emerald-200 font-semibold text-emerald-800"
                          : cell.leaveStatus === "pending"
                            ? "bg-amber-200 font-semibold text-amber-800"
                            : cell.leaveStatus === "rejected"
                              ? "bg-rose-200 font-semibold text-rose-800"
                              : cell.holidayName
                                ? "bg-red-100 font-semibold text-red-700"
                                : cell.isWeekend
                                  ? "bg-amber-100/70 text-amber-700"
                                  : "text-slate-700"
                  } ${cell?.isToday ? (theme === "dark" ? "ring-1 ring-violet-400" : "ring-1 ring-slate-400") : ""}`}
                  title={cell?.leaveStatus ? `Leave: ${cell.leaveStatus}${cell.leaveReason ? ` | ${cell.leaveReason}` : ""}` : cell?.holidayName || ""}
                >
                  {cell ? cell.day : "."}
                </div>
              ))}
            </div>

            <div className={`mt-2 border-t pt-2 ${theme === "dark" ? "border-slate-700" : "border-slate-200"}`}>
              {miniMonthHolidays.length ? (
                miniMonthHolidays.map((item) => (
                  <p key={item.key} className={`text-[11px] ${theme === "dark" ? "text-slate-300" : "text-slate-600"}`}>
                    {String(item.day).padStart(2, "0")} - {item.name}
                  </p>
                ))
              ) : (
                <p className={`text-[11px] ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>No listed holidays this month.</p>
              )}
            </div>
          </div>
        </aside>

        <div className="space-y-4">
          {message ? (
            <div
              className={`rounded-xl border p-3 text-sm font-medium ${
                theme === "dark"
                  ? "border-violet-800/60 bg-violet-500/10 text-violet-100"
                  : "border-blue-200 bg-blue-50/90 text-blue-900"
              }`}
            >
              {message}
            </div>
          ) : null}
          {busy ? (
            <div className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${theme === "dark" ? "border-violet-900/60 bg-slate-900/70 text-slate-200" : "border-slate-200 bg-white/95 text-slate-700"}`}>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing request. Please wait...
            </div>
          ) : null}

          {activeTab === "dashboard" ? (
            <SectionCard title="Attendance Module">
              {role === "employee" ? (
                <div className="mb-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleStartShift}
                      disabled={busy || shiftRunning}
                      className={btnSuccess}
                    >
                      {isLoading("start-shift") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {isLoading("start-shift") ? "Starting..." : "Start Shift"}
                    </button>
                    <button
                      onClick={handleEndShift}
                      disabled={busy || !shiftRunning}
                      className={btnDanger}
                    >
                      {isLoading("end-shift") ? <Loader2 className="h-4 w-4 animate-spin" /> : <StopCircle className="h-4 w-4" />}
                      {isLoading("end-shift") ? "Ending..." : "End Shift"}
                    </button>
                  </div>

                  <div className={`rounded-lg border p-3 ${theme === "dark" ? "border-violet-900/60 bg-slate-900/70" : "border-slate-200 bg-white"}`}>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className={`rounded-md border p-3 ${theme === "dark" ? "border-slate-800 bg-slate-950/60" : "border-slate-200 bg-slate-50"}`}>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-white">Shift Timer</p>
                        <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{shiftRunning ? formatDuration(shiftElapsedMs) : "00:00:00"}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-white">{shiftRunning ? `Live since shift start (${FIXED_SHIFT_LABEL})` : `Fixed shift ${FIXED_SHIFT_LABEL}`}</p>
                      </div>

                      <div className={`rounded-md border p-3 ${theme === "dark" ? "border-slate-800 bg-slate-950/60" : "border-slate-200 bg-slate-50"}`}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-white">Break Progress</p>
                          {activeBreakType ? (
                            <span
                              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                                isBreakOverrun
                                  ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-white"
                                  : "bg-blue-100 text-blue-700 dark:bg-violet-500/20 dark:text-white"
                              }`}
                            >
                              {activeBreakType}
                            </span>
                          ) : null}
                        </div>
                        {activeBreakType ? (
                          <>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                              <div
                                className={`h-full rounded-full transition-all ${isBreakOverrun ? "bg-red-500" : "bg-violet-600"}`}
                                style={{ width: `${breakProgress}%` }}
                              />
                            </div>
                            <div className="mt-2 flex items-center justify-between text-xs">
                              <span className="text-slate-700 dark:text-white">Elapsed: {formatDuration(breakElapsedMs)}</span>
                              <span className={isBreakOverrun ? "text-red-700 dark:text-white" : "text-slate-600 dark:text-white"}>
                                {isBreakOverrun ? `Over by ${formatDuration(breakElapsedMs - breakTargetMinutes * 60000)}` : `Left ${formatDuration(breakRemainingMs)}`}
                              </span>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-slate-600 dark:text-white">Start any break to see live progress.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                    <p className="mb-2 text-sm font-medium text-slate-700 dark:text-white">Breaks</p>
                    <div className="flex flex-wrap gap-2">
                      {["Tea", "Lunch", "Evening", "Breather"].map((type) => (
                        <button
                          key={type}
                          onClick={() => handleBreak(type, activeBreakType === type ? "end" : "start")}
                          disabled={busy || !shiftRunning}
                          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${
                            activeBreakType === type ? "border-orange-600 bg-orange-600 hover:bg-orange-700" : "border-violet-600 bg-violet-600 hover:bg-violet-700"
                          }`}
                        >
                          {isLoading(`break-${type}-${activeBreakType === type ? "end" : "start"}`) ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Coffee className="h-3.5 w-3.5" />
                          )}
                          {isLoading(`break-${type}-${activeBreakType === type ? "end" : "start"}`)
                            ? "Please wait..."
                            : activeBreakType === type
                              ? `End ${type}`
                              : `${type} Break`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {role === "manager" ? (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                  <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-white">Live Break Status</p>
                  {liveBreakRows.length ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {liveBreakRows.map((row, index) => {
                        const startedAt = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp || Date.now());
                        const elapsedMs = Math.max(0, clockTick - startedAt.getTime());
                        return (
                          <div key={`live-break-${row.id || row.employeeId || index}`} className="rounded-md border border-blue-200 bg-blue-50 p-2 dark:border-violet-700/50 dark:bg-violet-500/10">
                            <p className="text-sm font-medium text-slate-900 dark:text-white">{row.employeeName || row.empName || row.employeeId}</p>
                            <p className="text-xs text-slate-700 dark:text-white">{row.breakType || "Break"} break is active</p>
                            <p className="text-xs font-semibold text-blue-700 dark:text-white">Elapsed: {formatDuration(elapsedMs)}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-white">No one is on break right now.</p>
                  )}
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="min-w-full overflow-hidden rounded-lg text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-900/70">
                      <th className="px-3 py-2 text-slate-700 dark:text-white">Employee</th>
                      <th className="px-3 py-2 text-slate-700 dark:text-white">Action</th>
                      <th className="px-3 py-2 text-slate-700 dark:text-white">Date</th>
                      <th className="px-3 py-2 text-slate-700 dark:text-white">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(role === "manager" ? todayAttendanceRows : myAttendanceRows).map((row, index) => (
                      <tr key={`${row.id || row.empId}-${index}`} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/35 dark:border-slate-800 dark:odd:bg-slate-900/40 dark:even:bg-slate-900/20">
                        <td className="px-3 py-2 text-slate-700 dark:text-white">{row.empName}</td>
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-white">{formatActionLabel(row.action)}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-white">{formatDate(row.date)}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-white">{row.time || new Date(rowTime(row)).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(role === "manager" ? todayAttendanceRows : myAttendanceRows).length === 0 ? (
                  <p className="py-4 text-sm text-slate-500 dark:text-white">No attendance records for today.</p>
                ) : null}
              </div>
            </SectionCard>
          ) : null}

          {activeTab === "dashboard" ? (
            <>
              {role === "manager" ? (
                <SectionCard title="Team Attendance Heatmap (Last 14 Days)">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr>
                          <th className="border border-slate-200 bg-slate-100 px-2 py-1 text-left text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-white">
                            Employee
                          </th>
                          {heatmap.dates.map((d) => (
                            <th key={d} className="border border-slate-200 bg-slate-100 px-2 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-white">
                              {d.slice(8)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {heatmap.rows.map((r) => (
                          <tr key={r.employeeId}>
                            <td className="border border-slate-200 px-2 py-1 text-slate-700 dark:border-slate-700 dark:text-white">{r.name}</td>
                            {r.cells.map((p, idx) => (
                              <td
                                key={`${r.employeeId}-${idx}`}
                                className={`border border-slate-200 px-2 py-1 ${p ? "bg-emerald-200 text-emerald-900 dark:bg-emerald-500/30 dark:text-white" : "bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-white"} dark:border-slate-700`}
                              >
                                {p ? "P" : "A"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              ) : null}

              <SectionCard
                title={role === "manager" ? "Manager Dashboard" : "Employee Dashboard"}
              >
                {role === "manager" ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
                    <Stat label="Leave" value={pendingCounts.leaves} />
                    <Stat label="Worksheets" value={pendingCounts.worksheets} />
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-3">
                    <Stat label="My Tasks" value={taskRows.length} />
                    <Stat label="My Leaves" value={leaveRows.length} />
                    <Stat label="My Worksheets" value={worksheetRows.length} />
                  </div>
                )}
              </SectionCard>

              {role === "manager" ? (
                <>
                </>
              ) : null}
            </>
          ) : null}

          {activeTab === "profile" ? (
            <SectionCard title="My Profile">
              <div className="mb-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-lg font-semibold text-white">
                  {(user?.name || "U").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-slate-900 dark:text-white">{user?.name || "User"}</p>
                  <p className="truncate text-sm text-slate-600 dark:text-white">{user?.email || "-"}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {profileFields.map((field) => (
                  <div key={field.label} className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-white">{field.label}</p>
                    <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{field.value}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {activeTab === "leave" ? (
            <SectionCard title="Leave Request and Manager Approval">
              {role === "employee" ? (
                <form onSubmit={handleSubmitLeave} className="mb-4 grid gap-3 md:grid-cols-2">
                  <StyledDatePicker value={leaveForm.fromDate} onChange={(nextDate) => setLeaveForm((p) => ({ ...p, fromDate: nextDate }))} placeholder="From date" className="w-full" theme={theme} />
                  <StyledDatePicker value={leaveForm.toDate} onChange={(nextDate) => setLeaveForm((p) => ({ ...p, toDate: nextDate }))} placeholder="To date" className="w-full" theme={theme} />
                  <select value={leaveForm.leaveType} onChange={(e) => setLeaveForm((p) => ({ ...p, leaveType: e.target.value }))} className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option>General</option><option>Sick</option><option>Casual</option></select>
                  <input value={leaveForm.reason} onChange={(e) => setLeaveForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Reason" className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                  <button type="submit" disabled={busy} className={btnPrimary}>
                    {isLoading("submit-leave") ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {isLoading("submit-leave") ? "Submitting..." : "Submit Leave"}
                  </button>
                </form>
              ) : null}
              {role === "manager" ? (
                <form onSubmit={handleManagerSetHalfDayLeave} className="mb-4 grid gap-3 md:grid-cols-4">
                  <select
                    value={managerHalfDayForm.employeeId}
                    onChange={(e) => setManagerHalfDayForm((prev) => ({ ...prev, employeeId: e.target.value }))}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">Select employee</option>
                    {employeeList.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                  <StyledDatePicker
                    value={managerHalfDayForm.date}
                    onChange={(nextDate) => setManagerHalfDayForm((prev) => ({ ...prev, date: nextDate }))}
                    placeholder="Half day date"
                    className="w-full"
                    theme={theme}
                  />
                  <input
                    value={managerHalfDayForm.reason}
                    onChange={(e) => setManagerHalfDayForm((prev) => ({ ...prev, reason: e.target.value }))}
                    placeholder="Reason (e.g. Late arrival)"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                  <button type="submit" disabled={busy} className={btnPrimary}>
                    {isLoading("manager-half-day") ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {isLoading("manager-half-day") ? "Applying..." : "Set Half Day"}
                  </button>
                </form>
              ) : null}
              <SimpleLeaveTable
                rows={leaveRows}
                role={role}
                currentUserId={user?.id}
                busy={busy}
                loadingAction={loadingAction}
                onReview={async (id, decision, comment) => {
                  setBusy(true);
                  setLoadingAction(`leave-${id}-${decision}`);
                  try {
                    await reviewLeaveRequest({ leaveId: id, decision, comment, approverId: user.id, approverName: user.name });
                    setFlash(`Leave ${decision}.`);
                    refresh();
                  } catch (error) {
                    console.error(error);
                    setFlash("Could not review leave request.");
                  } finally {
                    setBusy(false);
                    setLoadingAction("");
                  }
                }}
                onCancel={async (id, comment) => {
                  setBusy(true);
                  setLoadingAction(`leave-cancel-${id}`);
                  try {
                    await cancelLeaveRequest({ leaveId: id, employeeId: user.id, employeeName: user.name, comment });
                    setFlash("Leave cancelled.");
                    refresh();
                  } catch (error) {
                    console.error(error);
                    setFlash("Could not cancel leave.");
                  } finally {
                    setBusy(false);
                    setLoadingAction("");
                  }
                }}
                onCancelByManager={async (id, comment) => {
                  setBusy(true);
                  setLoadingAction(`leave-manager-cancel-${id}`);
                  try {
                    await cancelManagerAssignedLeave({ leaveId: id, managerId: user.id, managerName: user.name, comment });
                    setFlash("Manager-assigned leave cancelled.");
                    refresh();
                  } catch (error) {
                    console.error(error);
                    setFlash("Could not cancel manager-assigned leave.");
                  } finally {
                    setBusy(false);
                    setLoadingAction("");
                  }
                }}
              />
            </SectionCard>
          ) : null}

          {activeTab === "tasks" ? (
            <SectionCard title="Daily Task Assignment and Work Start Flow">
              {role === "manager" ? (
                <form onSubmit={handleAssignTask} className="mb-4 grid gap-3 md:grid-cols-2">
                  <input value={taskForm.title} onChange={(e) => setTaskForm((p) => ({ ...p, title: e.target.value }))} placeholder="Task title" className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                  <select value={taskForm.assignedTo} onChange={(e) => setTaskForm((p) => ({ ...p, assignedTo: e.target.value }))} className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="">Assign to employee</option>{employeeList.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select>
                  <input value={taskForm.details} onChange={(e) => setTaskForm((p) => ({ ...p, details: e.target.value }))} placeholder="Task details" className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                  <select value={taskForm.priority} onChange={(e) => setTaskForm((p) => ({ ...p, priority: e.target.value }))} className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="high">High Priority</option><option value="medium">Medium Priority</option><option value="low">Low Priority</option></select>
                  <StyledDatePicker value={taskForm.dueDate} onChange={(nextDate) => setTaskForm((p) => ({ ...p, dueDate: nextDate }))} placeholder="Due date" className="w-full" theme={theme} />
                  <button type="submit" disabled={busy} className={btnPrimary}>
                    {isLoading("assign-task") ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {isLoading("assign-task") ? "Assigning..." : "Assign Task"}
                  </button>
                </form>
              ) : null}
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <Stat label="Assigned" value={taskSummaryStats.assigned} />
                <Stat label="In Progress" value={taskSummaryStats.inProgress} />
                <Stat label="Completed" value={taskSummaryStats.completed} />
              </div>
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <input
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search task title/details"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
                <select value={taskStatusFilter} onChange={(e) => setTaskStatusFilter(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white">
                  <option value="all">All Statuses</option>
                  <option value="assigned">Assigned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <select value={taskPriorityFilter} onChange={(e) => setTaskPriorityFilter(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white">
                  <option value="all">All Priorities</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              {filteredTaskRows.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  role={role}
                  busy={busy}
                  loadingAction={loadingAction}
                  onUpdate={async (status) => {
                    setBusy(true);
                    setLoadingAction(`task-${task.id}-${status}`);
                    try {
                      await updateTaskStatus({ taskId: task.id, status, actorId: user.id, actorName: user.name });
                      setFlash(`Task ${status}.`);
                      refresh();
                    } catch (error) {
                      console.error(error);
                      setFlash("Could not update task.");
                    } finally {
                      setBusy(false);
                      setLoadingAction("");
                    }
                  }}
                />
              ))}
              {filteredTaskRows.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-white">No tasks found for selected filters.</p>
              ) : null}
            </SectionCard>
          ) : null}

          {activeTab === "worksheets" ? (
            <SectionCard title="Employee Daily Worksheet (Day-wise)">
              {role === "employee" ? (
                <form onSubmit={handleWorksheetSubmit} className="mb-4 grid gap-3 md:grid-cols-2">
                  <StyledDatePicker value={worksheetForm.date} onChange={(nextDate) => setWorksheetForm((p) => ({ ...p, date: nextDate }))} placeholder="Worksheet date" className="w-full" theme={theme} />
                  <input value={worksheetForm.taskSummary} onChange={(e) => setWorksheetForm((p) => ({ ...p, taskSummary: e.target.value }))} placeholder="Task summary" className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                  <input value={worksheetForm.blockers} onChange={(e) => setWorksheetForm((p) => ({ ...p, blockers: e.target.value }))} placeholder="Blockers" className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                  <button type="submit" disabled={busy} className={btnPrimary}>
                    {isLoading("submit-worksheet") ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {isLoading("submit-worksheet") ? "Submitting..." : "Submit Worksheet"}
                  </button>
                </form>
              ) : null}
              {worksheetRows.map((row) => (
                <WorksheetCard
                  key={row.id}
                  row={row}
                />
              ))}
            </SectionCard>
          ) : null}

          {activeTab === "calendar" ? (
            <SectionCard title="Team Leave Calendar and Conflict Alerts">
              {role === "manager" ? (
                <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60 md:grid-cols-[1fr_auto_auto]">
                  <StyledDatePicker
                    value={saturdayHolidayDate}
                    onChange={setSaturdayHolidayDate}
                    placeholder="Select Saturday"
                    className="w-full"
                    theme={theme}
                  />
                  <button
                    type="button"
                    onClick={() => handleSaturdayHolidayUpdate(true)}
                    disabled={busy}
                    className={btnPrimary}
                  >
                    {isLoading("saturday-holiday-add") ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Mark Saturday Off
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaturdayHolidayUpdate(false)}
                    disabled={busy}
                    className={btnSecondary}
                  >
                    {isLoading("saturday-holiday-remove") ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Remove Saturday Off
                  </button>
                </div>
              ) : null}
              {leaveConflicts.length ? leaveConflicts.map((item) => (
                <div key={item.date} className="mb-2 rounded-md border border-orange-300 bg-orange-50 p-3 dark:border-orange-500/40 dark:bg-orange-500/10">
                  <p className="text-sm font-semibold text-orange-900 dark:text-white">Conflict Alert</p>
                  <p className="text-sm text-orange-800 dark:text-white">{formatDate(item.date)} has {item.count} approved leaves.</p>
                </div>
              )) : <p className="text-sm text-slate-500 dark:text-white">No leave conflicts detected.</p>}
            </SectionCard>
          ) : null}

          {activeTab === "exports" && role === "manager" ? (
            <SectionCard
              title="Export Center"
              right={
                <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${theme === "dark" ? "border border-violet-400/40 bg-violet-500/10" : "border border-violet-200 bg-violet-50"}`}>
                  <CalendarClock className="h-4 w-4 text-violet-700" />
                  <input
                    type="month"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                    className={`bg-transparent text-sm font-medium outline-none ${theme === "dark" ? "text-white" : "text-violet-900"}`}
                  />
                </div>
              }
            >
              <div
                className={`mb-4 rounded-2xl p-4 text-white shadow-lg ${
                  theme === "dark"
                    ? "border border-violet-400/30 bg-gradient-to-r from-slate-950 via-violet-950 to-fuchsia-950"
                    : "border border-violet-200/70 bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className={`text-xs uppercase tracking-[0.2em] ${theme === "dark" ? "text-white" : "text-violet-100"}`}>Monthly Attendance</p>
                    <h3 className="text-lg font-semibold">Download reports in one click</h3>
                    <p className={`text-sm ${theme === "dark" ? "text-white" : "text-violet-100"}`}>Present days are calculated from unique Shift Start entries.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={exportAttendanceExcel}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-md ${
                        theme === "dark"
                          ? "bg-violet-500/20 text-violet-100 ring-1 ring-violet-300/40 hover:bg-violet-500/30"
                          : "bg-white text-violet-700"
                      }`}
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      Export Excel
                    </button>
                    <button
                      onClick={exportAttendancePdf}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-md ${
                        theme === "dark" ? "bg-slate-800 hover:bg-slate-700" : "bg-slate-900/80 hover:bg-slate-950"
                      }`}
                    >
                      <FileText className="h-4 w-4" />
                      Export PDF
                    </button>
                  </div>
                </div>
              </div>

              <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className={`rounded-xl p-3 ${theme === "dark" ? "border border-slate-700 bg-slate-900/70" : "border border-slate-200 bg-slate-50"}`}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Employees</p>
                  <p className={`mt-1 text-2xl font-semibold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>{monthlySummary.length}</p>
                </div>
                <div className={`rounded-xl p-3 ${theme === "dark" ? "border border-slate-700 bg-slate-900/70" : "border border-slate-200 bg-slate-50"}`}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Payable Days Total</p>
                  <p className={`mt-1 text-2xl font-semibold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                    {monthlySummary.reduce((sum, row) => sum + Number((row.payableDays ?? row.presentDays) || 0), 0).toFixed(1)}
                  </p>
                </div>
                <div className={`rounded-xl p-3 sm:col-span-2 lg:col-span-1 ${theme === "dark" ? "border border-slate-700 bg-slate-900/70" : "border border-slate-200 bg-slate-50"}`}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Detailed Rows</p>
                  <p className={`mt-1 text-2xl font-semibold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>{filteredDetailedActivityRows.length}</p>
                </div>
              </div>

              <div className={`overflow-hidden rounded-xl ${theme === "dark" ? "border border-slate-700" : "border border-slate-200"}`}>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className={theme === "dark" ? "bg-slate-900/70" : "bg-slate-50"}>
                      <tr className={`text-left ${theme === "dark" ? "border-b border-slate-700" : "border-b border-slate-200"}`}>
                        <th className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-700"}`}>Employee</th>
                        <th className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-700"}`}>Present Days</th>
                        <th className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-700"}`}>Half Days</th>
                        <th className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-700"}`}>Payable Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlySummary.map((row) => (
                        <tr key={row.employeeId} className={`${theme === "dark" ? "border-b border-slate-800 hover:bg-slate-900/60" : "border-b border-slate-100 hover:bg-slate-50/70"} last:border-0`}>
                          <td className={`px-3 py-2.5 ${theme === "dark" ? "text-white" : "text-slate-800"}`}>{row.employeeName}</td>
                          <td className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>{row.presentDays}</td>
                          <td className={`px-3 py-2.5 ${theme === "dark" ? "text-white" : "text-slate-800"}`}>{row.halfDays || 0}</td>
                          <td className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>{row.payableDays ?? row.presentDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className={`rounded-2xl border p-4 ${theme === "dark" ? "border-emerald-400/30 bg-gradient-to-br from-emerald-900/30 to-slate-900/80" : "border-slate-200 bg-gradient-to-br from-emerald-50 to-white"}`}>
                  <div className="mb-3 flex items-center justify-between">
                    <p className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>Worksheet Export</p>
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">Excel</span>
                  </div>
                  <div className={`mb-3 inline-flex rounded-xl p-1 ${theme === "dark" ? "border border-slate-700 bg-slate-900/80" : "border border-slate-200 bg-white"}`}>
                    <button
                      onClick={() => setWorksheetExportMode("day")}
                      className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${worksheetExportMode === "day" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
                    >
                      Day-wise
                    </button>
                    <button
                      onClick={() => setWorksheetExportMode("month")}
                      className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${worksheetExportMode === "month" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
                    >
                      Month-wise
                    </button>
                  </div>

                  <div className="mb-3">
                    {worksheetExportMode === "day" ? (
                      <StyledDatePicker value={worksheetExportDay} onChange={setWorksheetExportDay} className="w-full max-w-[260px]" theme={theme} />
                    ) : (
                      <input
                        type="month"
                        value={worksheetExportMonth}
                        onChange={(e) => setWorksheetExportMonth(e.target.value)}
                        className={`rounded-lg px-3 py-2 text-sm ${theme === "dark" ? "border border-slate-600 bg-slate-900 text-slate-100" : "border border-slate-300 bg-white"}`}
                      />
                    )}
                  </div>

                  <button onClick={exportWorksheetExcel} className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-md">
                    <FileSpreadsheet className="h-4 w-4" />
                    Export Worksheet Excel
                  </button>
                </div>

                <div className={`rounded-2xl border p-4 ${theme === "dark" ? "border-blue-400/30 bg-gradient-to-br from-blue-900/30 to-slate-900/80" : "border-slate-200 bg-gradient-to-br from-blue-50 to-white"}`}>
                  <div className="mb-3 flex items-center justify-between">
                    <p className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>Detailed Attendance + Break Report</p>
                    <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">Live Data</span>
                  </div>
                  <div className={`mb-3 inline-flex rounded-xl p-1 ${theme === "dark" ? "border border-slate-700 bg-slate-900/80" : "border border-slate-200 bg-white"}`}>
                    <button
                      onClick={() => setActivityExportMode("day")}
                      className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${activityExportMode === "day" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
                    >
                      Day-wise
                    </button>
                    <button
                      onClick={() => setActivityExportMode("month")}
                      className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${activityExportMode === "month" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
                    >
                      Month-wise
                    </button>
                  </div>

                  <div className="mb-3 grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {activityExportMode === "day" ? (
                      <StyledDatePicker value={activityExportDay} onChange={setActivityExportDay} className="w-full md:col-span-1" triggerClassName="h-12 rounded-lg" theme={theme} />
                    ) : (
                      <input
                        type="month"
                        value={activityExportMonth}
                        onChange={(e) => setActivityExportMonth(e.target.value)}
                        className={`h-12 rounded-lg px-3 py-2 text-sm ${theme === "dark" ? "border border-slate-600 bg-slate-900 text-slate-100" : "border border-slate-300 bg-white"}`}
                      />
                    )}

                    <select
                      value={activityEmployeeFilter}
                      onChange={(e) => setActivityEmployeeFilter(e.target.value)}
                      className={`h-12 rounded-lg px-3 py-2 text-sm ${theme === "dark" ? "border border-slate-600 bg-slate-900 text-slate-100" : "border border-slate-300 bg-white"}`}
                    >
                      <option value="all">All Employees</option>
                      {employeeList.map((emp) => (
                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                      ))}
                    </select>

                    <button onClick={exportDetailedActivityExcel} className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-md">
                      <FileSpreadsheet className="h-4 w-4" />
                      Export Report
                    </button>
                  </div>
                </div>
              </div>

              <div className={`mt-5 overflow-hidden rounded-xl ${theme === "dark" ? "border border-slate-700" : "border border-slate-200"}`}>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className={theme === "dark" ? "bg-slate-900/70" : "bg-slate-50"}>
                      <tr className={`text-left ${theme === "dark" ? "border-b border-slate-700" : "border-b border-slate-200"}`}>
                        <th className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-700"}`}>Employee</th>
                        <th className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-700"}`}>Type</th>
                        <th className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-700"}`}>Action</th>
                        <th className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-700"}`}>Break</th>
                        <th className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-700"}`}>Date</th>
                        <th className={`px-3 py-2.5 font-semibold ${theme === "dark" ? "text-white" : "text-slate-700"}`}>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDetailedActivityRows.slice(0, 30).map((row, index) => (
                        <tr key={`detail-row-${row.employeeId}-${row.action}-${index}`} className={`${theme === "dark" ? "border-b border-slate-800 hover:bg-slate-900/60" : "border-b border-slate-100 hover:bg-slate-50/80"} last:border-0`}>
                          <td className={`px-3 py-2.5 ${theme === "dark" ? "text-white" : "text-slate-800"}`}>{row.employeeName}</td>
                          <td className={`px-3 py-2.5 capitalize ${theme === "dark" ? "text-white" : "text-slate-700"}`}>{row.eventType}</td>
                          <td className={`px-3 py-2.5 ${theme === "dark" ? "text-white" : "text-slate-800"}`}>{formatActionLabel(row.action)}</td>
                          <td className={`px-3 py-2.5 ${theme === "dark" ? "text-white" : "text-slate-700"}`}>{row.breakType || "-"}</td>
                          <td className={`px-3 py-2.5 ${theme === "dark" ? "text-white" : "text-slate-700"}`}>{row.displayDate}</td>
                          <td className={`px-3 py-2.5 ${theme === "dark" ? "text-white" : "text-slate-700"}`}>{row.displayTime}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredDetailedActivityRows.length === 0 ? (
                    <p className={`py-3 text-center text-sm ${theme === "dark" ? "text-white" : "text-slate-500"}`}>No records for selected filters.</p>
                  ) : null}
                </div>
              </div>
            </SectionCard>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function StyledDatePicker({ value, onChange, placeholder = "Select date", className = "", triggerClassName = "", theme = "light" }) {
  const wrapperRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selectedDate = useMemo(() => parseInputDate(value), [value]);
  const [viewMonth, setViewMonth] = useState(() => {
    const base = selectedDate || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const monthLabel = viewMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toInputDateValue(new Date());
  const selectedKey = selectedDate ? toInputDateValue(selectedDate) : "";
  const cells = [];

  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() =>
          setOpen((prev) => {
            const nextOpen = !prev;
            if (nextOpen && selectedDate) {
              setViewMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
            }
            return nextOpen;
          })
        }
        className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-left text-sm shadow-sm transition ${theme === "dark" ? "border border-slate-600 bg-slate-900 text-slate-100 hover:border-violet-400 hover:bg-slate-800" : "border border-slate-300 bg-white text-slate-800 hover:border-violet-300 hover:bg-violet-50/40"} ${triggerClassName}`}
      >
        <span>{selectedDate ? selectedDate.toLocaleDateString("en-GB") : placeholder}</span>
        <CalendarDays className={`h-4 w-4 ${theme === "dark" ? "text-white" : "text-slate-500"}`} />
      </button>

      {open ? (
        <div className={`absolute left-0 top-[calc(100%+8px)] z-40 w-72 rounded-xl p-3 shadow-2xl ${theme === "dark" ? "border border-slate-700 bg-slate-900" : "border border-slate-200 bg-white"}`}>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md ${theme === "dark" ? "text-white" : "text-slate-500 hover:bg-slate-100"}`}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>{monthLabel}</p>
            <button
              type="button"
              onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md ${theme === "dark" ? "text-white" : "text-slate-500 hover:bg-slate-100"}`}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((label, idx) => (
              <div key={`weekday-${label}-${idx}`} className={`py-1 text-center text-xs font-semibold ${theme === "dark" ? "text-white" : "text-slate-500"}`}>
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, idx) => {
              if (!date) return <div key={`empty-${idx}`} className="h-8 w-8" />;

              const dateKey = toInputDateValue(date);
              const isSelected = dateKey === selectedKey;
              const isToday = dateKey === todayKey;
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => {
                    onChange(toInputDateValue(date));
                    setOpen(false);
                  }}
                  className={`h-8 w-8 cursor-pointer rounded-md text-sm font-medium transition ${isSelected ? "bg-violet-600 text-white shadow-sm" : isWeekend ? theme === "dark" ? "text-white" : "text-violet-700 hover:bg-violet-50" : theme === "dark" ? "text-white" : "text-slate-700 hover:bg-slate-100"} ${isToday && !isSelected ? "ring-1 ring-violet-400" : ""}`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className={`mt-3 flex items-center justify-between pt-2 ${theme === "dark" ? "border-t border-slate-700" : "border-t border-slate-100"}`}>
            <button
              type="button"
              onClick={() => onChange("")}
              className={`cursor-pointer text-sm font-medium ${theme === "dark" ? "text-white" : "text-slate-500 hover:text-violet-700"}`}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                onChange(toInputDateValue(today));
                setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              }}
              className="cursor-pointer text-sm font-medium text-violet-700 hover:text-violet-800"
            >
              Today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }) {
  return <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/70"><p className="text-xs uppercase tracking-wide text-slate-500 dark:text-white">{label}</p><p className="text-2xl font-semibold text-slate-900 dark:text-white">{value}</p></div>;
}

function TaskCard({ task, role, onUpdate, busy, loadingAction }) {
  const starting = busy && loadingAction === `task-${task.id}-in_progress`;
  const completing = busy && loadingAction === `task-${task.id}-completed`;
  const cancelling = busy && loadingAction === `task-${task.id}-cancelled`;
  const reopening = busy && loadingAction === `task-${task.id}-assigned`;
  const canEmployeeStart = task.status === "assigned";
  const canEmployeeComplete = task.status === "assigned" || task.status === "in_progress";
  const priorityTone = task.priority === "high"
    ? "bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-white"
    : task.priority === "low"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-white"
      : "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-white";
  const dueDate = task.dueDate ? new Date(task.dueDate) : null;
  const isOverdue = dueDate && dueDate.getTime() < Date.now() && task.status !== "completed";

  return (
    <div className="mb-2 rounded-md border border-slate-200 p-3 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900 dark:text-white">{task.title}</p>
          <p className="text-sm text-slate-600 dark:text-white">{task.details}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${priorityTone}`}>{task.priority || "medium"} priority</span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${isOverdue ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-white"}`}>
              Due: {task.dueDate ? formatDate(task.dueDate) : "Not set"}
            </span>
            {task.startedAt ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700/40 dark:text-white">Started: {formatDate(task.startedAt)}</span> : null}
            {task.completedAt ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/20 dark:text-white">Completed: {formatDate(task.completedAt)}</span> : null}
          </div>
        </div>
        <span className={`rounded px-2 py-1 text-xs ${statusClass[task.status] || "bg-slate-100"}`}>{task.status}</span>
      </div>
      {role === "employee" && (canEmployeeStart || canEmployeeComplete) ? (
        <div className="mt-2 flex gap-2">
          {canEmployeeStart ? (
            <button
              onClick={() => onUpdate("in_progress")}
              disabled={busy}
              className={`${btnTinyPrimary} border-blue-600 bg-blue-600 hover:bg-blue-700`}
            >
              {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {starting ? "Starting..." : "Start"}
            </button>
          ) : null}
          {canEmployeeComplete ? (
            <button
              onClick={() => onUpdate("completed")}
              disabled={busy}
              className={btnTinySuccess}
            >
              {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {completing ? "Updating..." : "Done"}
            </button>
          ) : null}
        </div>
      ) : null}
      {role === "manager" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {task.status !== "completed" ? (
            <button onClick={() => onUpdate("completed")} disabled={busy} className={btnTinySuccess}>
              {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {completing ? "Updating..." : "Mark Complete"}
            </button>
          ) : null}
          {task.status !== "cancelled" ? (
            <button onClick={() => onUpdate("cancelled")} disabled={busy} className={btnTinyDanger}>
              {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {cancelling ? "Cancelling..." : "Cancel Task"}
            </button>
          ) : null}
          {(task.status === "cancelled" || task.status === "completed") ? (
            <button onClick={() => onUpdate("assigned")} disabled={busy} className={btnTinyPrimary}>
              {reopening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {reopening ? "Reopening..." : "Reopen"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorksheetCard({ row }) {
  return (
    <div className="mb-2 rounded-md border border-slate-200 p-3 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex items-center justify-between gap-3">
        <div><p className="font-medium text-slate-900 dark:text-white">{row.employeeName} - {formatDate(row.date)}</p><p className="text-sm text-slate-700 dark:text-white">{row.taskSummary}</p></div>
        <span className={`rounded px-2 py-1 text-xs ${statusClass[row.status] || "bg-slate-100"}`}>{row.status}</span>
      </div>
    </div>
  );
}

function SimpleLeaveTable({ rows, role, onReview, onCancel, onCancelByManager, currentUserId, busy, loadingAction }) {
  const [comments, setComments] = useState({});

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-left dark:border-slate-700"><th className="px-2 py-2">Employee</th><th className="px-2 py-2">Dates</th><th className="px-2 py-2">Reason</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">History</th>{role === "manager" || role === "employee" ? <th className="px-2 py-2">Actions</th> : null}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="px-2 py-2">{row.employeeName}</td>
              <td className="px-2 py-2">{formatDate(row.fromDateValue)} - {formatDate(row.toDateValue)}</td>
              <td className="px-2 py-2">{row.reason}</td>
              <td className="px-2 py-2"><span className={`rounded px-2 py-1 text-xs ${statusClass[row.status] || "bg-slate-100"}`}>{row.status}</span></td>
              <td className="px-2 py-2"><LeaveHistory row={row} /></td>
              {role === "manager" || role === "employee" ? (
                <td className="px-2 py-2">
                  {role === "manager" && (row.status === "pending" || row.status === "pending_l1" || row.status === "pending_l2") ? (
                    <>
                      <input
                        value={comments[row.id] || ""}
                        onChange={(event) => setComments((prev) => ({ ...prev, [row.id]: event.target.value }))}
                        placeholder="Comment"
                        className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                      />
                      <button
                        onClick={async () => {
                          await onReview(row.id, "approved", comments[row.id] || "");
                          setComments((prev) => ({ ...prev, [row.id]: "" }));
                        }}
                        disabled={busy}
                        className={`${btnTinySuccess} mr-2`}
                      >
                        {busy && loadingAction === `leave-${row.id}-approved` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {busy && loadingAction === `leave-${row.id}-approved` ? "Approving..." : "Approve"}
                      </button>
                      <button
                        onClick={async () => {
                          await onReview(row.id, "rejected", comments[row.id] || "");
                          setComments((prev) => ({ ...prev, [row.id]: "" }));
                        }}
                        disabled={busy}
                        className={btnTinyDanger}
                      >
                        {busy && loadingAction === `leave-${row.id}-rejected` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {busy && loadingAction === `leave-${row.id}-rejected` ? "Rejecting..." : "Reject"}
                      </button>
                    </>
                  ) : null}
                  {role === "employee" && row.employeeId === currentUserId && !row.managerAssigned && ["pending", "approved", "pending_l1", "pending_l2"].includes(row.status) ? (
                    <button
                      onClick={async () => {
                        await onCancel?.(row.id, comments[row.id] || "");
                        setComments((prev) => ({ ...prev, [row.id]: "" }));
                      }}
                      disabled={busy}
                      className={btnTinyDanger}
                    >
                      {busy && loadingAction === `leave-cancel-${row.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {busy && loadingAction === `leave-cancel-${row.id}` ? "Cancelling..." : "Cancel Leave"}
                    </button>
                  ) : null}
                  {role === "manager" && row.managerAssigned && row.status === "approved" ? (
                    <button
                      onClick={async () => {
                        await onCancelByManager?.(row.id, comments[row.id] || "");
                        setComments((prev) => ({ ...prev, [row.id]: "" }));
                      }}
                      disabled={busy}
                      className={btnTinyDanger}
                    >
                      {busy && loadingAction === `leave-manager-cancel-${row.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {busy && loadingAction === `leave-manager-cancel-${row.id}` ? "Cancelling..." : "Manager Cancel"}
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaveHistory({ row }) {
  const history = (row.approvalTrail || []).filter((item) => item?.status && item.status !== "pending" && item?.at);

  if (!history.length) {
    return <span className="text-xs text-slate-500 dark:text-white">No review history</span>;
  }

  return (
    <div className="space-y-1">
      {history.map((item, index) => (
        <div key={`${row.id}-trail-${index}`} className="text-xs text-slate-600 dark:text-white">
          <span className="font-medium">{item.status}</span> by {item.approverName || "Manager"} on {formatDate(item.at)}
          {item.comment ? ` | ${item.comment}` : ""}
        </div>
      ))}
    </div>
  );
}









