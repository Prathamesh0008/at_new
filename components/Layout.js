// components/Layout.js - UPDATE THIS (remove html/body)
'use client';
import { usePathname } from 'next/navigation';
import Navbar from './Navbar';
import ModelSidebar from './ModelPortal/ModelSidebar';
import UserSidebar from './UserPortal/UserSidebar';

export default function Layout({ children }) {
  const pathname = usePathname();
  let userRole = 'user';

  if (typeof window !== 'undefined') {
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        userRole = user.role || 'user';
      }
    } catch {
      userRole = 'user';
    }
  }
  
  return (
    <>
      <Navbar />
      
      <div className="flex">
        {userRole === 'model' && pathname?.startsWith('/model') && <ModelSidebar />}
        {userRole === 'user' && pathname?.startsWith('/user') && <UserSidebar />}
        
        <main className={`${
          (userRole === 'model' && pathname?.startsWith('/model')) || 
          (userRole === 'user' && pathname?.startsWith('/user')) 
            ? 'flex-1' 
            : 'w-full'
        } p-4 md:p-6`}>
          {children}
        </main>
      </div>
    </>
  );
}
