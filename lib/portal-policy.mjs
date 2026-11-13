// Server policy. IDs and roles come exclusively from a verified session.
export const COLLECTIONS = Object.freeze(['attendance', 'attendanceDaily', 'breaks', 'activities', 'leave_requests', 'leave_requests_v2', 'daily_tasks', 'daily_worksheets', 'portal_notifications', 'reimbursements', 'attendance_corrections', 'portal_settings', 'salary_slip_requests', 'salary_slips']);
export const deny = (message = 'Access denied', status = 403) => { throw Object.assign(new Error(message), { status }); };
export const manager = user => user?.id === 'NTS-MGR' && user.role === 'manager';
export function ownerFields(name) { return name === 'daily_tasks' ? ['assignedTo', 'employeeId'] : ['employeeId', 'empId']; }
export function canRead(user, name, row) {
  if (!user?.id || !COLLECTIONS.includes(name)) return false;
  if (name === 'portal_settings') return true;
  if (name === 'portal_notifications') return row.recipientId ? row.recipientId === user.id : row.recipientRole ? row.recipientRole === user.role : true;
  if (manager(user)) return true;
  const owners = ownerFields(name).map(field => row[field]).filter(Boolean);
  return owners.length > 0 && owners.every(id => id === user.id);
}
const fields = value => new Set(value.split(' '));
const ownCreate = {
  leave_requests: fields('employeeId empId employeeName empName fromDate toDate reason status appliedDate createdAt days leaveType'),
  leave_requests_v2: fields('employeeId employeeName employeeEmail department leaveType fromDate toDate reason days status approvalLevel approvalTrail appliedAt createdAt updatedAt'),
  daily_worksheets: fields('employeeId employeeName date taskSummary hoursWorked blockers status createdAt updatedAt'),
  reimbursements: fields('employeeId employeeName employeeEmail date amount category description reason receipt attachment status reviewComment reviewHistory createdAt updatedAt'),
  attendance_corrections: fields('employeeId employeeName date reason requestedLoginTime requestedLogoutTime clockIn clockOut correctionType details status reviewComment reviewHistory createdAt updatedAt'),
  salary_slip_requests: fields('employeeId employeeName employeeEmail month notes status reviewedBy reviewedByName reviewComment reviewedAt generatedSlipId createdAt updatedAt'),
  activities: fields('employeeId empId employeeName empName action type message breakType exceededBy workingHours totalBreaks reason browser platform timestamp createdAt'),
};
const ownUpdate = {
  leave_requests_v2: fields('reason reasonUpdatedAt reasonUpdatedBy status cancellationComment cancelledBy cancelledByName cancelledAt updatedAt'),
  daily_tasks: fields('status updatedAt lastActionBy lastActionByName statusHistory startedAt completedAt cancelledAt reopenedAt'),
  daily_worksheets: ownCreate.daily_worksheets,
};
const actors = ['assignedBy', 'lastActionBy', 'reviewedBy', 'updatedBy', 'generatedBy', 'managerAssignedById', 'reasonUpdatedBy', 'cancelledBy'];
export function authorizeWrite(user, name, prior, input, operation, now = new Date().toISOString()) {
  if (!user?.id || !COLLECTIONS.includes(name)) deny();
  if (['attendance', 'attendanceDaily', 'breaks'].includes(name)) deny('Use the protected attendance command endpoint');
  const data = { ...input };
  if (Object.keys(data).some(key => /[./]|^(__proto__|constructor|prototype)$/.test(key))) deny('Invalid field', 400);
  if (prior && !canRead(user, name, prior)) deny();
  if (prior) for (const key of ['employeeId', 'empId', 'assignedTo', 'createdBy', 'recipientId', 'recipientRole']) if (key in data && data[key] !== prior[key]) deny('Ownership cannot be changed');
  for (const key of actors) if (data[key] && data[key] !== user.id) deny('Actor does not match session');
  if (name === 'portal_notifications') {
    if (prior) {
      if (!canRead(user, name, prior) || Object.keys(data).some(key => !['read', 'readAt', 'updatedAt'].includes(key)) || data.read !== true) deny();
    } else {
      if (!manager(user) && data.recipientId !== user.id && data.recipientId !== 'NTS-MGR' && !(data.recipientRole === 'manager' && !data.recipientId)) deny();
      if (!manager(user) && (!data.recipientId && !data.recipientRole)) deny();
      if (Object.keys(data).some(key => !fields('recipientId recipientRole title message type meta read createdAt updatedAt').has(key))) deny();
      data.read = false; data.createdBy = user.id;
    }
    return data;
  }
  if (manager(user)) {
    if (name === 'portal_settings' && Object.keys(data).some(key => !['saturdayHolidays', 'updatedAt', 'updatedBy', 'updatedByName'].includes(key))) deny();
    // Administrative operations are permitted only on these enumerated portal
    // collections; auth, throttles and manager records are never generic CRUD.
    for (const key of actors) if (key in data) data[key] = user.id;
    if (name === 'daily_tasks' && prior && data.status) data.statusHistory = [...(prior.statusHistory || []), { from: prior.status, to: data.status, by: user.id, byName: user.name, at: now }];
    if (['reimbursements','attendance_corrections'].includes(name) && prior && data.status) data.reviewHistory = [...(prior.reviewHistory || []), { status: data.status, comment: data.reviewComment || '', reviewerId: user.id, reviewerName: user.name, at: now }];
    for (const key of ['reviewedBy','updatedBy','generatedBy','assignedBy','lastActionBy']) if (key in data) data[`${key}Name`] = user.name;
    if ('reviewedAt' in data) data.reviewedAt = now;
    return data;
  }
  if (name === 'portal_settings' || name === 'salary_slips') deny();
  const allowed = prior ? ownUpdate[name] : ownCreate[name];
  if (!allowed || Object.keys(data).some(key => !allowed.has(key))) deny('Operation or field is not permitted');
  if (!prior) {
    for (const key of ownerFields(name)) if (data[key] && data[key] !== user.id) deny();
    data.employeeId = user.id; data.employeeName = user.name;
    if ('empId' in data) data.empId = user.id;
    if ('employeeEmail' in data) data.employeeEmail = user.email || '';
    if (name === 'daily_worksheets') data.status = 'submitted';
    if (['leave_requests_v2', 'leave_requests', 'reimbursements', 'attendance_corrections', 'salary_slip_requests'].includes(name)) {
      if (data.status && !['pending', 'Pending'].includes(data.status)) deny('Self-approval is not permitted');
      if (name === 'leave_requests_v2') { data.approvalLevel = 1; data.approvalTrail = [{ level: 1, role: 'manager', status: 'pending', at: null, by: null, comment: '' }]; }
      if ('reviewHistory' in data) data.reviewHistory = [];
      if ('reviewComment' in data) data.reviewComment = '';
      if ('reviewedBy' in data) data.reviewedBy = '';
      if ('reviewedByName' in data) data.reviewedByName = '';
      if ('reviewedAt' in data) data.reviewedAt = null;
      if ('generatedSlipId' in data) data.generatedSlipId = '';
    }
  } else if (name === 'leave_requests_v2') {
    if (prior.managerAssigned || !['pending', 'pending_l1', 'pending_l2', 'approved'].includes(prior.status)) deny();
    if (data.status && data.status !== 'cancelled') deny('Self-approval is not permitted');
    if (data.reason && !['pending', 'pending_l1', 'pending_l2'].includes(prior.status)) deny();
  } else if (name === 'daily_tasks') {
    if (!['in_progress', 'completed'].includes(data.status)) deny('Only a manager can assign, reopen or cancel tasks');
    data.statusHistory = [...(prior.statusHistory || []), { from: prior.status, to: data.status, by: user.id, byName: user.name, at: now }];
    data.lastActionBy = user.id; data.lastActionByName = user.name;
    if ('startedAt' in data) data.startedAt = now;
    if ('completedAt' in data) data.completedAt = now;
  } else if (name === 'daily_worksheets' && data.status !== 'submitted') deny('Only a manager can review worksheets');
  if ('employeeName' in data) data.employeeName = user.name;
  if ('employeeEmail' in data) data.employeeEmail = user.email || '';
  if ('cancelledByName' in data) data.cancelledByName = user.name;
  for (const key of ['reasonUpdatedAt','cancelledAt']) if (key in data) data[key] = now;
  return data;
}
