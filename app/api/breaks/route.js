import { saveBreak, getEmployeeBreaks } from '@/lib/attendanceStorage';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    
    if (!employeeId) {
      return Response.json([], { status: 200 });
    }
    
    const breaks = getEmployeeBreaks(employeeId);
    return Response.json(breaks);
  } catch (error) {
    console.error('Error:', error);
    return Response.json([], { status: 200 });
  }
}

export async function POST(request) {
  try {
    const data = await request.json();
    const { employeeId, employeeName, breakType, action } = data;
    if (String(employeeId || '').trim().toUpperCase() === 'NTS-MGR') {
      return Response.json({ error: 'Manager attendance requires the protected manager endpoint' }, { status: 403 });
    }
    
    const result = await saveBreak({
      employeeId,
      employeeName,
      breakType,
      action
    });

    if (!result?.success) {
      return Response.json(
        { error: 'Failed to persist break update', success: false },
        { status: 500 }
      );
    }
    
    return Response.json({
      message: `${breakType} break ${action}ed`,
      success: result.success,
      timestamp: result.timestamp,
      storage: {
        excel: result.excel,
        firebase: result.firebase
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: 'Failed to save break' }, { status: 500 });
  }
}
