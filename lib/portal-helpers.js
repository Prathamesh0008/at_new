'use client';

import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { fetchAllAttendanceData } from "@/lib/firebase-helpers";
import { MANAGER, employees } from "@/utils/constants";

const COLLECTIONS = {
  LEAVES: "leave_requests_v2",
  TASKS: "daily_tasks",
  WORKSHEETS: "daily_worksheets",
  NOTIFICATIONS: "portal_notifications",
  REIMBURSEMENTS: "reimbursements",
  CORRECTIONS: "attendance_corrections",
  SETTINGS: "portal_settings",
  SALARY_REQUESTS: "salary_slip_requests",
  SALARY_SLIPS: "salary_slips",
};

const toDate = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  return new Date(value);
};

const mapDoc = (snapshot) => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    ...data,
    createdAtDate: toDate(data.createdAt),
    updatedAtDate: toDate(data.updatedAt),
    fromDateValue: data.fromDate || "",
    toDateValue: data.toDate || "",
  };
};

const sortByLatest = (items) =>
  [...items].sort((a, b) => {
    const timeA = a.createdAtDate?.getTime() || 0;
    const timeB = b.createdAtDate?.getTime() || 0;
    return timeB - timeA;
  });

const getEmployeeById = (employeeId) => employees.find((emp) => emp.id === employeeId);

const sendPortalEmail = async ({ to, subject, htmlContent = "", emailType = null, emailData = null }) => {
  if (!to) return;

  try {
    await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, htmlContent, emailType, emailData }),
    });
  } catch (error) {
    console.error("Portal email failed:", error);
  }
};

export const createNotification = async ({
  recipientId = null,
  recipientRole = null,
  title,
  message,
  type = "info",
  meta = {},
}) => {
  await addDoc(collection(db, COLLECTIONS.NOTIFICATIONS), {
    recipientId,
    recipientRole,
    title,
    message,
    type,
    meta,
    read: false,
    createdAt: serverTimestamp(),
  });
};

export const fetchNotifications = async ({ recipientId, role }) => {
  const snapshot = await getDocs(collection(db, COLLECTIONS.NOTIFICATIONS));
  const rows = snapshot.docs.map(mapDoc);

  return sortByLatest(
    rows.filter((row) => {
      const forUser = row.recipientId && row.recipientId === recipientId;
      const forRole = row.recipientRole && row.recipientRole === role;
      const broadcast = !row.recipientId && !row.recipientRole;
      return forUser || forRole || broadcast;
    })
  );
};

const isNotificationVisibleToUser = ({ row, recipientId, role }) => {
  const forUser = row.recipientId && row.recipientId === recipientId;
  const forRole = row.recipientRole && row.recipientRole === role;
  const broadcast = !row.recipientId && !row.recipientRole;
  return forUser || forRole || broadcast;
};

export const markNotificationRead = async (notificationId) => {
  if (!notificationId) return;
  await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, notificationId), {
    read: true,
    readAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const markAllNotificationsRead = async ({ recipientId, role }) => {
  const snapshot = await getDocs(collection(db, COLLECTIONS.NOTIFICATIONS));
  const targets = snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((row) => isNotificationVisibleToUser({ row, recipientId, role }) && !row.read);

  if (!targets.length) return 0;

  await Promise.all(
    targets.map((row) =>
      updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, row.id), {
        read: true,
        readAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    )
  );

  return targets.length;
};

export const submitLeaveRequest = async (payload) => {
  const leaveData = {
    employeeId: payload.employeeId,
    employeeName: payload.employeeName,
    employeeEmail: payload.employeeEmail || "",
    department: payload.department || "Operations",
    leaveType: payload.leaveType || "General",
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    reason: payload.reason,
    days: payload.days || 1,
    status: "pending",
    approvalLevel: 1,
    approvalTrail: [
      { level: 1, role: "manager", status: "pending", at: null, by: null, comment: "" },
    ],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, COLLECTIONS.LEAVES), leaveData);

  await createNotification({
    recipientRole: "manager",
    title: "New leave request",
    message: `${payload.employeeName} requested leave (${payload.fromDate} to ${payload.toDate}).`,
    type: "leave",
    meta: { leaveId: ref.id },
  });

  await sendPortalEmail({
    to: MANAGER.email,
    subject: `Leave request: ${payload.employeeName}`,
    emailType: "leaveApplication",
    emailData: {
      employeeName: payload.employeeName,
      employeeId: payload.employeeId,
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      reason: payload.reason,
    },
  });

  return ref.id;
};

export const assignHalfDayLeaveByManager = async ({
  employeeId,
  date,
  reason,
  leaveType = "half_day",
  managerId,
  managerName,
}) => {
  if (!employeeId || !date || !reason) throw new Error("Employee, date, and reason are required.");

  const emp = getEmployeeById(employeeId);
  if (!emp) throw new Error("Employee not found.");
  const normalizedLeaveType = String(leaveType || "half_day").toLowerCase();
  const isFullDay = normalizedLeaveType === "full_day";
  const leaveTypeLabel = isFullDay ? "Full Day" : "Half Day";
  const leaveDays = isFullDay ? 1 : 0.5;

  const leaveData = {
    employeeId,
    employeeName: emp.name,
    employeeEmail: emp.email || "",
    department: emp.department || "Operations",
    leaveType: leaveTypeLabel,
    fromDate: date,
    toDate: date,
    reason,
    days: leaveDays,
    status: "approved",
    approvalLevel: 1,
    approvalTrail: [
      {
        level: 1,
        role: "manager",
        status: "approved",
        at: new Date().toISOString(),
        by: managerId || "",
        approverName: managerName || "Manager",
        comment: reason,
      },
    ],
    reviewComment: reason,
    managerAssigned: true,
    managerAssignedById: managerId || "",
    managerAssignedByName: managerName || "Manager",
    managerAssignedAt: new Date().toISOString(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, COLLECTIONS.LEAVES), leaveData);

  await createNotification({
    recipientId: employeeId,
    title: `${leaveTypeLabel} leave assigned`,
    message: `${managerName || "Manager"} marked ${date} as ${leaveTypeLabel.toLowerCase()} leave.`,
    type: "leave",
    meta: { leaveId: ref.id },
  });

  await sendPortalEmail({
    to: emp.email,
    subject: `${leaveTypeLabel} Leave Applied: ${date}`,
    htmlContent: `<p>Hello ${emp.name}, your manager has marked <b>${date}</b> as <b>${leaveTypeLabel} Leave</b>.</p><p>Reason: ${reason}</p>`,
  });

  return ref.id;
};

export const fetchLeaveRequests = async (filters = {}) => {
  const snapshot = await getDocs(collection(db, COLLECTIONS.LEAVES));
  const rows = sortByLatest(snapshot.docs.map(mapDoc));

  return rows.filter((row) => {
    if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
    if (filters.department && row.department !== filters.department) return false;
    if (filters.statuses?.length && !filters.statuses.includes(row.status)) return false;
    return true;
  });
};

export const reviewLeaveRequest = async ({ leaveId, decision, approverId, approverName, comment = "" }) => {
  const ref = doc(db, COLLECTIONS.LEAVES, leaveId);
  const snap = await getDoc(ref);

  if (!snap.exists()) throw new Error("Leave request not found.");

  const leave = snap.data();
  const trail = Array.isArray(leave.approvalTrail) ? [...leave.approvalTrail] : [];
  const pendingIndex = trail.findIndex((item) => item?.status === "pending");
  const trailIndex = pendingIndex >= 0 ? pendingIndex : 0;

  trail[trailIndex] = {
    ...(trail[trailIndex] || { level: 1, role: "manager" }),
    status: decision,
    at: new Date().toISOString(),
    by: approverId,
    approverName,
    comment,
  };

  const nextStatus = decision === "approved" ? "approved" : "rejected";
  const nextLevel = 1;

  await updateDoc(ref, {
    approvalTrail: trail,
    reviewComment: comment || "",
    status: nextStatus,
    approvalLevel: nextLevel,
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientId: leave.employeeId,
    title: `Leave ${nextStatus.replace("_", " ")}`,
    message: `${approverName} marked your leave request as ${nextStatus}.`,
    type: "leave",
    meta: { leaveId },
  });

  const emp = getEmployeeById(leave.employeeId);
  await sendPortalEmail({
    to: emp?.email,
    subject: `Leave ${nextStatus}: ${leave.fromDate} to ${leave.toDate}`,
    htmlContent: `<p>Hello ${leave.employeeName}, your leave request is now <b>${nextStatus}</b>.</p>`,
  });
};

export const cancelLeaveRequest = async ({ leaveId, employeeId, employeeName, comment = "" }) => {
  const ref = doc(db, COLLECTIONS.LEAVES, leaveId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Leave request not found.");

  const leave = snap.data();
  if (leave.employeeId !== employeeId) throw new Error("You can cancel only your own leave.");
  if (leave.managerAssigned) throw new Error("Manager-assigned leaves can only be cancelled by manager.");
  if (["rejected", "cancelled"].includes(leave.status)) throw new Error("This leave cannot be cancelled.");

  await updateDoc(ref, {
    status: "cancelled",
    cancellationComment: comment || "",
    cancelledBy: employeeId,
    cancelledByName: employeeName,
    cancelledAt: new Date().toISOString(),
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientRole: "manager",
    title: "Leave cancelled",
    message: `${employeeName} cancelled leave (${leave.fromDate} to ${leave.toDate}).`,
    type: "leave",
    meta: { leaveId },
  });

  await createNotification({
    recipientId: employeeId,
    title: "Leave cancelled",
    message: `You cancelled your leave (${leave.fromDate} to ${leave.toDate}).`,
    type: "leave",
    meta: { leaveId },
  });
};

export const cancelManagerAssignedLeave = async ({ leaveId, managerId, managerName, comment = "" }) => {
  const ref = doc(db, COLLECTIONS.LEAVES, leaveId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Leave request not found.");

  const leave = snap.data();
  if (!leave.managerAssigned) throw new Error("Only manager-assigned leaves can be cancelled here.");
  if (["rejected", "cancelled"].includes(leave.status)) throw new Error("This leave cannot be cancelled.");

  await updateDoc(ref, {
    status: "cancelled",
    cancellationComment: comment || "",
    cancelledBy: managerId || "",
    cancelledByName: managerName || "Manager",
    cancelledByRole: "manager",
    cancelledAt: new Date().toISOString(),
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientId: leave.employeeId,
    title: "Manager cancelled leave",
    message: `${managerName || "Manager"} cancelled your leave (${leave.fromDate} to ${leave.toDate}).`,
    type: "leave",
    meta: { leaveId },
  });

  const emp = getEmployeeById(leave.employeeId);
  await sendPortalEmail({
    to: emp?.email,
    subject: `Leave cancelled by manager: ${leave.fromDate}`,
    htmlContent: `<p>Hello ${leave.employeeName}, your manager cancelled the leave for ${leave.fromDate}.</p>`,
  });
};

export const createTask = async (payload) => {
  const ref = await addDoc(collection(db, COLLECTIONS.TASKS), {
    title: payload.title,
    details: payload.details || "",
    assignedTo: payload.assignedTo,
    assignedToName: payload.assignedToName,
    assignedBy: payload.assignedBy,
    assignedByName: payload.assignedByName,
    priority: payload.priority || "medium",
    dueDate: payload.dueDate || null,
    status: "assigned",
    statusHistory: [
      {
        from: "new",
        to: "assigned",
        by: payload.assignedBy || "",
        byName: payload.assignedByName || "",
        at: new Date().toISOString(),
      },
    ],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientId: payload.assignedTo,
    title: "New task assigned",
    message: `${payload.assignedByName} assigned: ${payload.title}`,
    type: "task",
    meta: { taskId: ref.id },
  });

  const emp = getEmployeeById(payload.assignedTo);
  await sendPortalEmail({
    to: emp?.email,
    subject: `New task assigned: ${payload.title}`,
    htmlContent: `<p>${payload.assignedByName} assigned a new task.</p><p><b>${payload.title}</b><br/>${payload.details || ""}</p>`,
  });

  return ref.id;
};

export const fetchTasks = async (filters = {}) => {
  const snapshot = await getDocs(collection(db, COLLECTIONS.TASKS));
  const rows = sortByLatest(snapshot.docs.map(mapDoc));

  return rows.filter((row) => {
    if (filters.assignedTo && row.assignedTo !== filters.assignedTo) return false;
    if (filters.assignedBy && row.assignedBy !== filters.assignedBy) return false;
    return true;
  });
};

export const updateTaskStatus = async ({ taskId, status, actorId, actorName }) => {
  const ref = doc(db, COLLECTIONS.TASKS, taskId);
  const snap = await getDoc(ref);

  if (!snap.exists()) throw new Error("Task not found.");

  const task = snap.data();
  const previousStatus = task.status || "assigned";
  const history = Array.isArray(task.statusHistory) ? [...task.statusHistory] : [];
  history.push({
    from: previousStatus,
    to: status,
    by: actorId || "",
    byName: actorName || "",
    at: new Date().toISOString(),
  });

  const updates = {
    status,
    updatedAt: serverTimestamp(),
    lastActionBy: actorId,
    lastActionByName: actorName,
    statusHistory: history,
  };
  if (status === "in_progress" && !task.startedAt) updates.startedAt = new Date().toISOString();
  if (status === "completed") updates.completedAt = new Date().toISOString();
  if (status === "cancelled") updates.cancelledAt = new Date().toISOString();
  if (status === "assigned") updates.reopenedAt = new Date().toISOString();

  await updateDoc(ref, updates);

  await createNotification({
    recipientId: task.assignedBy,
    title: "Task updated",
    message: `${task.assignedToName} marked "${task.title}" as ${status}.`,
    type: "task",
    meta: { taskId },
  });

  await sendPortalEmail({
    to: MANAGER.email,
    subject: `Task status update: ${task.title}`,
    htmlContent: `<p>${actorName} marked task <b>${task.title}</b> as <b>${status}</b>.</p>`,
  });
};

export const upsertWorksheet = async (payload) => {
  const snapshot = await getDocs(collection(db, COLLECTIONS.WORKSHEETS));
  const existing = snapshot.docs.find((row) => {
    const data = row.data();
    return data.employeeId === payload.employeeId && data.date === payload.date;
  });

  if (existing) {
    await updateDoc(doc(db, COLLECTIONS.WORKSHEETS, existing.id), {
      ...payload,
      status: payload.status || "submitted",
      updatedAt: serverTimestamp(),
    });

    await sendPortalEmail({
      to: MANAGER.email,
      subject: `Worksheet updated: ${payload.employeeName}`,
      htmlContent: `<p>${payload.employeeName} updated worksheet for ${payload.date}.</p>`,
    });

    return existing.id;
  }

  const ref = await addDoc(collection(db, COLLECTIONS.WORKSHEETS), {
    ...payload,
    status: payload.status || "submitted",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientRole: "manager",
    title: "Worksheet submitted",
    message: `${payload.employeeName} submitted worksheet for ${payload.date}.`,
    type: "worksheet",
    meta: { worksheetId: ref.id },
  });

  await sendPortalEmail({
    to: MANAGER.email,
    subject: `Worksheet submitted: ${payload.employeeName}`,
    htmlContent: `<p>${payload.employeeName} submitted worksheet for ${payload.date}.</p>`,
  });

  return ref.id;
};

export const fetchWorksheets = async (filters = {}) => {
  const snapshot = await getDocs(collection(db, COLLECTIONS.WORKSHEETS));
  const rows = sortByLatest(snapshot.docs.map(mapDoc));

  return rows.filter((row) => {
    if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
    if (filters.status && row.status !== filters.status) return false;
    return true;
  });
};

export const reviewWorksheet = async ({ worksheetId, status, reviewerId, reviewerName }) => {
  const ref = doc(db, COLLECTIONS.WORKSHEETS, worksheetId);
  const snap = await getDoc(ref);

  if (!snap.exists()) throw new Error("Worksheet not found.");

  const row = snap.data();

  await updateDoc(ref, {
    status,
    reviewedBy: reviewerId,
    reviewedByName: reviewerName,
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientId: row.employeeId,
    title: "Worksheet reviewed",
    message: `${reviewerName} marked your worksheet as ${status}.`,
    type: "worksheet",
    meta: { worksheetId },
  });

  const emp = getEmployeeById(row.employeeId);
  await sendPortalEmail({
    to: emp?.email,
    subject: `Worksheet ${status}`,
    htmlContent: `<p>${reviewerName} marked your worksheet as <b>${status}</b>.</p>`,
  });
};

export const createReimbursementRequest = async (payload) => {
  const ref = await addDoc(collection(db, COLLECTIONS.REIMBURSEMENTS), {
    ...payload,
    status: "pending",
    reviewComment: "",
    reviewHistory: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientRole: "manager",
    title: "New reimbursement request",
    message: `${payload.employeeName} requested reimbursement of INR ${payload.amount}.`,
    type: "reimbursement",
    meta: { reimbursementId: ref.id },
  });

  return ref.id;
};

export const fetchReimbursements = async (filters = {}) => {
  const snapshot = await getDocs(collection(db, COLLECTIONS.REIMBURSEMENTS));
  const rows = sortByLatest(snapshot.docs.map(mapDoc));

  return rows.filter((row) => {
    if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
    if (filters.status && row.status !== filters.status) return false;
    return true;
  });
};

export const reviewReimbursement = async ({
  reimbursementId,
  status,
  reviewerId,
  reviewerName,
  comment = "",
}) => {
  const ref = doc(db, COLLECTIONS.REIMBURSEMENTS, reimbursementId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Reimbursement request not found.");

  const row = snap.data();
  const history = Array.isArray(row.reviewHistory) ? [...row.reviewHistory] : [];
  history.push({
    status,
    comment: comment || "",
    reviewerId,
    reviewerName,
    at: new Date().toISOString(),
  });

  await updateDoc(ref, {
    status,
    reviewedBy: reviewerId,
    reviewedByName: reviewerName,
    reviewComment: comment || "",
    reviewHistory: history,
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientId: row.employeeId,
    title: "Reimbursement reviewed",
    message: `${reviewerName} marked your reimbursement request as ${status}.`,
    type: "reimbursement",
    meta: { reimbursementId },
  });
};

export const createAttendanceCorrectionRequest = async (payload) => {
  const ref = await addDoc(collection(db, COLLECTIONS.CORRECTIONS), {
    ...payload,
    status: "pending",
    reviewComment: "",
    reviewHistory: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientRole: "manager",
    title: "Attendance correction requested",
    message: `${payload.employeeName} requested correction for ${payload.date}.`,
    type: "correction",
    meta: { correctionId: ref.id },
  });

  return ref.id;
};

export const fetchAttendanceCorrections = async (filters = {}) => {
  const snapshot = await getDocs(collection(db, COLLECTIONS.CORRECTIONS));
  const rows = sortByLatest(snapshot.docs.map(mapDoc));

  return rows.filter((row) => {
    if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
    if (filters.status && row.status !== filters.status) return false;
    return true;
  });
};

export const reviewAttendanceCorrection = async ({
  correctionId,
  status,
  reviewerId,
  reviewerName,
  comment = "",
}) => {
  const ref = doc(db, COLLECTIONS.CORRECTIONS, correctionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Correction request not found.");

  const row = snap.data();
  const history = Array.isArray(row.reviewHistory) ? [...row.reviewHistory] : [];
  history.push({
    status,
    comment: comment || "",
    reviewerId,
    reviewerName,
    at: new Date().toISOString(),
  });

  await updateDoc(ref, {
    status,
    reviewedBy: reviewerId,
    reviewedByName: reviewerName,
    reviewComment: comment || "",
    reviewHistory: history,
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientId: row.employeeId,
    title: "Correction reviewed",
    message: `${reviewerName} marked your attendance correction as ${status}.`,
    type: "correction",
    meta: { correctionId },
  });
};

export const fetchPendingCounts = async () => {
  const [leaves, worksheets, reimbursements, corrections] = await Promise.all([
    fetchLeaveRequests({ statuses: ["pending", "pending_l1", "pending_l2"] }),
    fetchWorksheets({ status: "submitted" }),
    fetchReimbursements({ status: "pending" }),
    fetchAttendanceCorrections({ status: "pending" }),
  ]);

  return {
    leaves: leaves.length,
    worksheets: worksheets.length,
    reimbursements: reimbursements.length,
    corrections: corrections.length,
  };
};

export const createSalarySlipRequest = async (payload) => {
  const requestData = {
    employeeId: payload.employeeId,
    employeeName: payload.employeeName,
    employeeEmail: payload.employeeEmail || "",
    month: payload.month,
    notes: payload.notes || "",
    status: "pending",
    reviewedBy: "",
    reviewedByName: "",
    reviewComment: "",
    reviewedAt: null,
    generatedSlipId: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, COLLECTIONS.SALARY_REQUESTS), requestData);

  await createNotification({
    recipientRole: "manager",
    title: "Salary slip request",
    message: `${payload.employeeName} requested salary slip for ${payload.month}.`,
    type: "info",
    meta: { requestId: ref.id },
  });

  return ref.id;
};

export const fetchSalarySlipRequests = async (filters = {}) => {
  const snapshot = await getDocs(collection(db, COLLECTIONS.SALARY_REQUESTS));
  const rows = sortByLatest(snapshot.docs.map(mapDoc));

  return rows.filter((row) => {
    if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
    if (filters.statuses?.length && !filters.statuses.includes(row.status)) return false;
    return true;
  });
};

export const reviewSalarySlipRequest = async ({
  requestId,
  decision,
  managerId,
  managerName,
  comment = "",
}) => {
  const ref = doc(db, COLLECTIONS.SALARY_REQUESTS, requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Salary request not found.");

  const row = snap.data();
  const nextStatus = decision === "approved" ? "approved" : "rejected";

  await updateDoc(ref, {
    status: nextStatus,
    reviewedBy: managerId || "",
    reviewedByName: managerName || "Manager",
    reviewComment: comment || "",
    reviewedAt: new Date().toISOString(),
    updatedAt: serverTimestamp(),
  });

  await createNotification({
    recipientId: row.employeeId,
    title: `Salary request ${nextStatus}`,
    message: `${managerName || "Manager"} marked your salary slip request (${row.month}) as ${nextStatus}.`,
    type: "info",
    meta: { requestId },
  });
};

export const createSalarySlipRecord = async ({
  requestId = "",
  employeeId,
  employeeName,
  department = "Operations",
  month,
  payDate,
  payableDays = 0,
  remarks = "",
  earnings = {},
  deductions = {},
  gross = 0,
  totalDeductions = 0,
  net = 0,
  generatedBy,
  generatedByName,
}) => {
  if (!employeeId || !month) throw new Error("Employee and month are required.");

  const snapshot = await getDocs(collection(db, COLLECTIONS.SALARY_SLIPS));
  const existing = snapshot.docs.find((docSnap) => {
    const data = docSnap.data();
    return data.employeeId === employeeId && data.month === month;
  });

  const payload = {
    requestId: requestId || "",
    employeeId,
    employeeName,
    department,
    month,
    payDate,
    payableDays,
    remarks: remarks || "",
    earnings,
    deductions,
    gross,
    totalDeductions,
    net,
    generatedBy: generatedBy || "",
    generatedByName: generatedByName || "Manager",
    generatedAt: new Date().toISOString(),
    updatedAt: serverTimestamp(),
  };

  let slipId = "";
  if (existing) {
    slipId = existing.id;
    await updateDoc(doc(db, COLLECTIONS.SALARY_SLIPS, existing.id), payload);
  } else {
    const ref = await addDoc(collection(db, COLLECTIONS.SALARY_SLIPS), {
      ...payload,
      createdAt: serverTimestamp(),
    });
    slipId = ref.id;
  }

  if (requestId) {
    const requestRef = doc(db, COLLECTIONS.SALARY_REQUESTS, requestId);
    await updateDoc(requestRef, {
      generatedSlipId: slipId,
      generatedAt: new Date().toISOString(),
      status: "generated",
      updatedAt: serverTimestamp(),
    });
  }

  await createNotification({
    recipientId: employeeId,
    title: "Salary slip generated",
    message: `Salary slip for ${month} is generated and available for download.`,
    type: "info",
    meta: { slipId, month },
  });

  return slipId;
};

export const fetchSalarySlips = async (filters = {}) => {
  const snapshot = await getDocs(collection(db, COLLECTIONS.SALARY_SLIPS));
  const rows = sortByLatest(snapshot.docs.map(mapDoc));

  return rows.filter((row) => {
    if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
    if (filters.month && row.month !== filters.month) return false;
    return true;
  });
};

export const fetchPortalSettings = async () => {
  const ref = doc(db, COLLECTIONS.SETTINGS, "attendance_policy");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { saturdayHolidays: [] };
  }
  const data = snap.data();
  return {
    saturdayHolidays: Array.isArray(data.saturdayHolidays) ? data.saturdayHolidays : [],
  };
};

export const setSaturdayHoliday = async ({ date, isHoliday, managerId, managerName }) => {
  if (!date) throw new Error("Date is required.");

  const ref = doc(db, COLLECTIONS.SETTINGS, "attendance_policy");
  const snap = await getDoc(ref);
  const current = snap.exists() && Array.isArray(snap.data()?.saturdayHolidays)
    ? snap.data().saturdayHolidays
    : [];

  const next = isHoliday
    ? Array.from(new Set([...current, date])).sort()
    : current.filter((item) => item !== date);

  await setDoc(ref, {
    saturdayHolidays: next,
    updatedAt: serverTimestamp(),
    updatedBy: managerId || "",
    updatedByName: managerName || "Manager",
  }, { merge: true });

  return next;
};

export const fetchMonthlyAttendanceSummary = async ({ year, month, employees: sourceEmployees }) => {
  const [attendance, leaves] = await Promise.all([
    fetchAllAttendanceData(),
    fetchLeaveRequests({ statuses: ["approved"] }),
  ]);
  const monthIndex = Number(month) - 1;

  const monthRows = attendance.filter((row) => {
    const date = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
    return date.getFullYear() === Number(year) && date.getMonth() === monthIndex;
  });

  const byEmployee = new Map();
  const halfDayByEmployee = new Map();

  leaves.forEach((row) => {
    const leaveType = String(row.leaveType || "").toLowerCase();
    const isHalfDay = leaveType.includes("half") || Number(row.days) === 0.5;
    if (!isHalfDay) return;
    const from = new Date(row.fromDateValue || row.fromDate || "");
    if (Number.isNaN(from.getTime())) return;
    if (from.getFullYear() !== Number(year) || from.getMonth() !== monthIndex) return;
    const dateKey = (row.fromDateValue || row.fromDate || "").slice(0, 10);
    if (!dateKey) return;
    const set = halfDayByEmployee.get(row.employeeId) || new Set();
    set.add(dateKey);
    halfDayByEmployee.set(row.employeeId, set);
  });

  monthRows.forEach((row) => {
    const key = row.empId;
    const current = byEmployee.get(key) || {
      employeeId: row.empId,
      employeeName: row.empName,
      workedDaysSet: new Set(),
      overtimeCount: 0,
      totalRecords: 0,
    };

    const date = row.date || (row.timestamp instanceof Date ? row.timestamp.toISOString().slice(0, 10) : "");
    if (row.action === "clock-in") current.workedDaysSet.add(date);

    const totalHours = Number(String(row.workingHours || "").split(":")[0] || 0);
    if (totalHours >= 9) current.overtimeCount += 1;

    current.totalRecords += 1;
    byEmployee.set(key, current);
  });

  return (sourceEmployees || [])
    .filter((emp) => emp.role !== "manager")
    .map((emp) => {
      const row = byEmployee.get(emp.id);
      const workedDaysSet = row?.workedDaysSet || new Set();
      const halfDaysSet = halfDayByEmployee.get(emp.id) || new Set();
      const presentDateSet = new Set([...workedDaysSet, ...halfDaysSet]);
      let payableDays = 0;
      presentDateSet.forEach((dateKey) => {
        payableDays += halfDaysSet.has(dateKey) ? 0.5 : 1;
      });

      return {
        employeeId: emp.id,
        employeeName: emp.name,
        presentDays: presentDateSet.size,
        halfDays: halfDaysSet.size,
        payableDays: Number(payableDays.toFixed(1)),
        overtimeDays: row?.overtimeCount || 0,
        attendanceRecords: row?.totalRecords || 0,
      };
    });
};
