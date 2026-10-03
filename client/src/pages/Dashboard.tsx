import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { formatDistanceToNow } from 'date-fns';

export function Dashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') || 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const search = searchParams.get('search') || '';

  const [searchInput, setSearchInput] = useState(search);

  const { data: counts } = useQuery({
    queryKey: ['dashboard-counts'],
    queryFn: api.getDashboardCounts,
    refetchInterval: 30000,
  });

  const { data: workItemsData, isLoading } = useQuery({
    queryKey: ['work-items', view, page, search],
    queryFn: () => api.listWorkItems({ view, page, search }),
    refetchInterval: 30000,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams((prev) => {
      if (searchInput) {
        prev.set('search', searchInput);
      } else {
        prev.delete('search');
      }
      prev.set('page', '1');
      return prev;
    });
  };

  const setView = (newView: string) => {
    setSearchParams((prev) => {
      prev.set('view', newView);
      prev.set('page', '1');
      return prev;
    });
  };

  const setPage = (newPage: number) => {
    setSearchParams((prev) => {
      prev.set('page', newPage.toString());
      return prev;
    });
  };

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: api.me,
  });

  return (
    <div>
      <div className="page-header">
        <h2>
          Dashboard{' '}
          {currentUser && (
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
              — Hey, {currentUser.name.split(' ')[0]} 👋
              {currentUser.teamMemberships.length > 0 && (
                <span style={{ fontSize: '0.95em', marginLeft: 16, color: '#000', fontWeight: 700 }}>
                  Team: {currentUser.teamMemberships.map((m: any) => m.team.name).join(', ')}
                </span>
              )}
            </span>
          )}
        </h2>
      </div>

      <div className="stats-grid">
        <div className={`stat-card ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}>
          <div className="stat-value">{counts?.open ?? '-'}</div>
          <div className="stat-label">Open</div>
        </div>
        <div className={`stat-card warning ${view === 'mine' ? 'active' : ''}`} onClick={() => setView('mine')}>
          <div className="stat-value">{counts?.assignedToMe ?? '-'}</div>
          <div className="stat-label">My Active Work</div>
        </div>
        <div className={`stat-card critical ${view === 'critical' ? 'active' : ''}`} onClick={() => setView('critical')}>
          <div className="stat-value">{counts?.critical ?? '-'}</div>
          <div className="stat-label">Critical / High</div>
        </div>
        <div className={`stat-card info ${view === 'unassigned' ? 'active' : ''}`} onClick={() => setView('unassigned')}>
          <div className="stat-value">{counts?.unassigned ?? '-'}</div>
          <div className="stat-label">Unassigned</div>
        </div>
        <div className={`stat-card ${view === 'pending_approval' ? 'active' : ''}`} onClick={() => setView('pending_approval')}>
          <div className="stat-value">{counts?.pendingApproval ?? '-'}</div>
          <div className="stat-label">Pending Approval</div>
        </div>
      </div>

      <div className="filters-bar">
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', flex: 1 }}>
          <input
            type="text"
            className="search-input"
            placeholder="Search reference or title..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary">Search</button>
        </form>
      </div>

      {isLoading ? (
        <div className="loading">
          <div className="spinner"></div>
          Loading work items...
        </div>
      ) : workItemsData?.items.length === 0 ? (
        <div className="empty-state">
          <h3>No work items found</h3>
          <p>Try adjusting your filters or search query.</p>
        </div>
      ) : (
        <>
          <table className="work-items-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Title</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Team</th>
                <th>Assignee</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {workItemsData?.items.map((item) => (
                <tr key={item.id} onClick={() => navigate(`/work-items/${item.id}`)}>
                  <td className="work-item-ref">{item.reference}</td>
                  <td className="work-item-title">{item.title}</td>
                  <td>
                    <span className={`badge badge-priority-${item.priority}`}>
                      {item.priority}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-status-${item.status}`}>
                      {item.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{item.team.name}</td>
                  <td>{item.assignee ? item.assignee.name : <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {workItemsData && workItemsData.totalPages > 1 && (
            <div className="pagination">
              <div className="pagination-info">
                Showing page {workItemsData.page} of {workItemsData.totalPages} ({workItemsData.total} total items)
              </div>
              <div className="pagination-buttons">
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={workItemsData.page === 1}
                  onClick={() => setPage(workItemsData.page - 1)}
                >
                  Previous
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={workItemsData.page === workItemsData.totalPages}
                  onClick={() => setPage(workItemsData.page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
