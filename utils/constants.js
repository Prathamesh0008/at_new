// export const ROLES = {
//   AGENT: 'agent',
//   MANAGER: 'manager',
//   ADMIN: 'admin'
// };
// /utils/constants.js
export const employees = [
  { 
    id: "NTS-002", 
    name: "Adarsh Singh", 
    shift: "10:00 AM - 7:00 PM",
    email: "adarsh@asblogi.com",
    phone: "+91 9876543211",
    role: "agent",
    department: "Operations",
    password: "adarsh123",
    dateOfJoining: "2026-01-10"
  },
  { 
    id: "NTS-005", 
    name: "RUSHIKESH ANDHALE", 
    shift: "10:00 AM - 7:00 PM",
    email: "rushikesh@asblogi.com",
    phone: "+91 9867006814",
    role: "agent",
    department: "Operations",
    password: "rushikesh123",
    dateOfJoining: "2025-10-10"
  },
  { 
    id: "NTS-006", 
    name: "Upasana Patil", 
    shift: "10:00 AM - 7:00 PM",
    email: "upasana@asblogi.com",
    phone: "+91 9876543215",
    role: "agent",
    department: "Operations",
    password: "upasana123",
    dateOfJoining: "2025-10-10"
  },
  { 
    id: "NTS-008", 
    name: "Chotelal Singh", 
    shift: "10:00 AM - 7:00 PM",
    email: "chhotelal@asblogi.com",
    phone: "+91 9876543217",
    role: "agent",
    department: "Operations",
    password: "chotelal123",
    dateOfJoining: "2025-11-10"
  },
  { 
    id: "NTS-MGR", 
    name: "Prathamesh Shinde ", 
    shift: "10:00 AM - 7:00 PM",
    email: "novadesigns79@gmail.com",
    phone: "+91 9876543210",
    role: "manager",
    department: "Management",
    password: "manager123",
    dateOfJoining: "2024-07-01"
  }
];

export const MANAGER = {
  name: "Prathamesh Shinde",
  email: "novadesigns79@gmail.com",
  phone: "+91 9876543210"
};

export const ADMIN_PASSWORD = "nova2024";

export const PROJECT_STATUS = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold'
};

export const PRIORITY_LEVELS = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical'
};

export const ROLES = {
  AGENT: 'agent',
  MANAGER: 'manager'
};

export const sampleProjects = [
  {
    id: "PROJ-001",
    name: "E-commerce Platform",
    description: "Build a full-stack e-commerce platform with payment integration",
    status: PROJECT_STATUS.IN_PROGRESS,
    priority: PRIORITY_LEVELS.HIGH,
    assignedTo: ["NTS-001", "NTS-002", "NTS-005"],
    deadline: "2024-12-31",
    progress: 65,
    createdAt: "2024-01-15"
  },
  // ... ALL projects here
];

// export const ADMIN_PASSWORD = "Sky@2204";
