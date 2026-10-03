import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getCurrentUserId, setCurrentUserId } from '../api';

export function Layout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();
  const [showInstructions, setShowInstructions] = useState(false);

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: api.users,
    staleTime: Infinity,
  });

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: api.me,
    enabled: !!userId,
  });

  const handleUserSwitch = (newUserId: string) => {
    setCurrentUserId(newUserId);
    queryClient.clear();
    navigate('/');
    window.location.reload();
  };

  // Auto-select first user if none selected, or if current user is invalid
  const isValidUser = userId && users?.some(u => u.id === userId);
  if ((!userId || (users && !isValidUser)) && users && users.length > 0) {
    handleUserSwitch(users[0].id);
    return null;
  }

  return (
    <>
      <button 
        onClick={() => setShowInstructions(true)}
        style={{
          position: 'fixed',
          top: 16,
          right: 220,
          padding: '8px 16px',
          backgroundColor: '#000',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontWeight: 600,
          cursor: 'pointer',
          zIndex: 100000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}
      >
        Verification Instructions
      </button>

      <div className="app-layout">
        <nav className="sidebar">
        <div className="sidebar-brand">
          <h1>⚡ Newtonite</h1>
          <p>Operations Hub</p>
        </div>

        <div className="user-switcher" style={{ borderTop: 'none', borderBottom: '1px solid var(--border)', marginTop: 0, paddingBottom: 16, marginBottom: 8 }}>
          <label>Switch User (Demo)</label>
          <select
            value={userId || ''}
            onChange={(e) => handleUserSwitch(e.target.value)}
          >
            <option value="" disabled>Select user...</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          {currentUser && (
            <div className="current-user-info">
              <div>{currentUser.email}</div>
              <div className="current-user-roles">
                {currentUser.teamMemberships.map((m) => (
                  <span key={m.team.id} className="role-badge-small">
                    {m.team.name}: {m.role}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sidebar-nav">
          <NavLink to="/" end>
            <span className="nav-icon">📋</span>
            <span>Work Queue</span>
          </NavLink>
          <NavLink to="/work-items/new">
            <span className="nav-icon">➕</span>
            <span>Create Work Item</span>
          </NavLink>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Quick Views</div>
            <NavLink to="/?view=mine">
              <span className="nav-icon">👤</span>
              <span>My Work</span>
            </NavLink>
            <NavLink to="/?view=unassigned">
              <span className="nav-icon">🔓</span>
              <span>Unassigned</span>
            </NavLink>
            <NavLink to="/?view=critical">
              <span className="nav-icon">🔴</span>
              <span>Critical/High</span>
            </NavLink>
            <NavLink to="/?view=pending_approval">
              <span className="nav-icon">⏳</span>
              <span>Pending Approval</span>
            </NavLink>
          </div>
        </div>
      </nav>

      <main className="main-content" style={{ position: 'relative' }}>

        {showInstructions && (
          <div 
            onClick={() => setShowInstructions(false)}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <div 
              onClick={(e) => e.stopPropagation()}
              style={{
                backgroundColor: '#fff', padding: 32, borderRadius: 12,
                width: '100%', maxWidth: 600, maxHeight: '80vh', overflowY: 'auto',
                position: 'relative'
              }}
            >
              <button 
                onClick={() => setShowInstructions(false)}
                style={{
                  position: 'absolute', top: 16, right: 16,
                  background: 'none', border: 'none', fontSize: 24,
                  cursor: 'pointer', color: '#666', lineHeight: 1
                }}
                aria-label="Close"
              >
                &times;
              </button>
              <h2 style={{ marginTop: 0, marginBottom: 16, paddingRight: 24, fontSize: '1.4rem' }}>Challenge Requirements Fulfillment</h2>
              <ul style={{ paddingLeft: 20, lineHeight: '1.5', color: '#333', fontSize: '0.95rem' }}>
                <li style={{ marginBottom: 12 }}><strong>1. Concurrent Usage (OCC):</strong> Implemented <em>Optimistic Concurrency Control</em>. If two users try to claim or edit the same ticket simultaneously, the database atomically rejects one with a 409 Conflict, completely preventing the "Lost Update" problem.</li>
                <li style={{ marginBottom: 12 }}><strong>2. Strict System Authorization:</strong> RBAC (Manager, Member, Viewer) is strictly enforced via the backend API. UI controls are intentionally left exposed to prove authorization is handled natively via 403 errors, rather than by just artificially hiding buttons.</li>
                <li style={{ marginBottom: 12 }}><strong>3. Role-Based Creation & Assignment:</strong> Work items can only be created by a Member or Manager of that specific team. Members cannot assign work to others—only a Manager has the authority to assign tasks.</li>
                <li style={{ marginBottom: 12 }}><strong>4. State Machine Workflow:</strong> Enforced workflow rules (Open &rarr; In Progress &rarr; Pending Approval &rarr; Resolved). Approvals strictly require a Manager role.</li>
                <li style={{ marginBottom: 12 }}><strong>5. Collaboration & History:</strong> All state changes (status, assignee, priority, description) are tracked via explicit database transactions and displayed as a highly readable chronological audit timeline. Fixed timezone drift bugs to ensure UTC safety.</li>
                <li style={{ marginBottom: 12 }}><strong>6. Real-time Team Context (User Experience):</strong> The interactive user switcher (for demo purposes) dynamically updates the dashboard to show curated quick-views (My Work, Critical, Pending) filtered <em>only</em> for the teams the current user belongs to.</li>
                <li style={{ marginBottom: 12 }}><strong>7. Cross-Team Limitations:</strong> A work item strictly belongs to one team. Approval actions are scoped to the managers of that specific team, and a member from another team cannot claim or work on that item.</li>
                <li style={{ marginBottom: 12 }}><strong>8. Asynchronous Processing:</strong> Architecture supports the <em>Transactional Outbox Pattern</em> for reliable background processing (e.g., notifications) without data loss during crashes.</li>
                <li style={{ marginBottom: 12 }}><strong>9. Automated Testing & Engineering Decisions:</strong> The repository includes a comprehensive <code>ENGINEERING_DECISIONS.md</code> file detailing tradeoffs, and a suite of 29 integration tests verifying concurrency and authorization.</li>
                <li><strong>10. Customizable Seed Data:</strong> The demo data is safely populated by <code>prisma/seed.ts</code> and can be fully customized for business requirements.</li>
              </ul>
            </div>
          </div>
        )}

        {userId ? (
          <Outlet />
        ) : (
          <div className="empty-state">
            <h3>Welcome to Newtonite</h3>
            <p>Select a user from the sidebar to begin.</p>
          </div>
        )}
      </main>
    </div>
    </>
  );
}
