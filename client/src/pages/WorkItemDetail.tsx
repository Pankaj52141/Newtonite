import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { formatDistanceToNow, format } from 'date-fns';

export function WorkItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  
  const [commentText, setCommentText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const { data: item, isLoading, error } = useQuery({
    queryKey: ['work-item', id],
    queryFn: () => api.getWorkItem(id!),
    enabled: !!id,
    retry: false,
  });

  useQuery({
    queryKey: ['current-user'],
    queryFn: api.me,
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: api.users,
  });

  const { data: commentsData } = useQuery({
    queryKey: ['work-item-comments', id],
    queryFn: () => api.getComments(id!),
    enabled: !!id,
  });

  const { data: activityData } = useQuery({
    queryKey: ['work-item-activity', id],
    queryFn: () => api.getActivity(id!),
    enabled: !!id,
  });

  // Mutations
  const claimMutation = useMutation({
    mutationFn: () => api.claimWorkItem(id!, item!.version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-item', id] });
      queryClient.invalidateQueries({ queryKey: ['work-item-activity', id] });
      showToast('Work item claimed successfully', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  const transitionMutation = useMutation({
    mutationFn: (status: string) => api.transitionWorkItem(id!, status, item!.version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-item', id] });
      queryClient.invalidateQueries({ queryKey: ['work-item-activity', id] });
      showToast('Status updated', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });
  
  const approveMutation = useMutation({
    mutationFn: () => api.approveWorkItem(id!, item!.version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-item', id] });
      queryClient.invalidateQueries({ queryKey: ['work-item-activity', id] });
      showToast('Work item approved', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  const addCommentMutation = useMutation({
    mutationFn: (body: string) => api.addComment(id!, body),
    onSuccess: () => {
      setCommentText('');
      queryClient.invalidateQueries({ queryKey: ['work-item-comments', id] });
      queryClient.invalidateQueries({ queryKey: ['work-item-activity', id] });
      showToast('Comment added', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });
  
  const updateMutation = useMutation({
    mutationFn: (data: { title: string, description: string }) => 
      api.updateWorkItem(id!, { ...data, expectedVersion: item!.version }),
    onSuccess: () => {
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['work-item', id] });
      queryClient.invalidateQueries({ queryKey: ['work-item-activity', id] });
      showToast('Work item updated', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  const priorityMutation = useMutation({
    mutationFn: (priority: string) => api.changePriority(id!, priority, item!.version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-item', id] });
      queryClient.invalidateQueries({ queryKey: ['work-item-activity', id] });
      showToast('Priority updated', 'success');
    },
    onError: (err: any) => showToast(err.message, 'error')
  });

  const assignMutation = useMutation({
    mutationFn: (assigneeId: string) => api.assignWorkItem(id!, assigneeId, item!.version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-item', id] });
      queryClient.invalidateQueries({ queryKey: ['work-item-activity', id] });
      showToast('Work item reassigned', 'success');
    },
    onError: (err: any) => showToast(err.message, 'error')
  });

  if (isLoading) return <div className="loading"><div className="spinner"></div></div>;
  
  if (error || !item) {
    return (
      <div className="empty-state">
        <h3>Error loading work item</h3>
        <p>{(error as Error)?.message || 'Item not found'}</p>
        <button className="btn btn-primary" onClick={() => navigate('/')} style={{ marginTop: 16 }}>
          Back to Dashboard
        </button>
      </div>
    );
  }


  const handleStartEdit = () => {
    setEditTitle(item.title);
    setEditDesc(item.description || '');
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!editTitle.trim()) return showToast('Title is required', 'error');
    updateMutation.mutate({ title: editTitle, description: editDesc });
  };

  return (
    <div>
      <button className="btn btn-ghost" onClick={() => navigate('/')} style={{ marginBottom: 16 }}>
        ← Back to Queue
      </button>

      <div className="detail-grid">
        <div className="detail-main">
          <div className="detail-header">
            <div className="detail-header-info">
              <div className="detail-header-ref">{item.reference}</div>
              
              {isEditing ? (
                <div style={{ marginBottom: 16 }}>
                  <input 
                    className="form-input" 
                    value={editTitle} 
                    onChange={e => setEditTitle(e.target.value)} 
                    style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}
                  />
                </div>
              ) : (
                <h2 className="detail-header-title">{item.title}</h2>
              )}
            </div>
            
            <div className="btn-group">
              {!isEditing && (
                <button className="btn btn-secondary btn-sm" onClick={handleStartEdit}>
                  Edit
                </button>
              )}
              {isEditing && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => setIsEditing(false)}>Cancel</button>
                  <button 
                    className="btn btn-primary btn-sm" 
                    onClick={handleSaveEdit}
                    disabled={updateMutation.isPending}
                  >
                    Save
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="detail-meta">
            <div>
              <div className="meta-item-label">Status</div>
              <span className={`badge badge-status-${item.status}`}>
                {item.status.replace('_', ' ')}
              </span>
            </div>
            <div>
              <div className="meta-item-label">Priority</div>
              <span className={`badge badge-priority-${item.priority}`}>
                {item.priority}
              </span>
            </div>
            <div>
              <div className="meta-item-label">Assignee</div>
              <div className="meta-item-value">
                {item.assignee ? item.assignee.name : 'Unassigned'}
              </div>
            </div>
            <div>
              <div className="meta-item-label">Team</div>
              <div className="meta-item-value">{item.team.name}</div>
            </div>
          </div>

          <div className="meta-item-label" style={{ marginBottom: 8 }}>Description</div>
          {isEditing ? (
            <textarea 
              className="form-textarea" 
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              style={{ marginBottom: 24 }}
            />
          ) : (
            <div className="detail-description">
              {item.description || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>No description provided.</span>}
            </div>
          )}

          <div style={{ marginTop: 32 }}>
            <h3 style={{ marginBottom: 16 }}>Discussion</h3>
            
            <div className="comments-list">
              {commentsData?.items.map(comment => (
                <div key={comment.id} className="comment">
                  <div className="comment-header">
                    <span className="comment-author">{comment.author.name}</span>
                    <span className="comment-time">{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</span>
                  </div>
                  <div className="comment-body">{comment.body}</div>
                </div>
              ))}
              
              {(!commentsData || commentsData.items.length === 0) && (
                <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
                  No comments yet.
                </div>
              )}
            </div>

            <div className="comment-form">
                <textarea 
                  placeholder="Add a comment..." 
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button 
                    className="btn btn-primary"
                    disabled={!commentText.trim() || addCommentMutation.isPending}
                    onClick={() => addCommentMutation.mutate(commentText)}
                  >
                    Post Comment
                  </button>
                </div>
              </div>
          </div>
        </div>

        <div className="detail-sidebar">
          <div className="card">
            <h3 style={{ fontSize: 14, marginBottom: 16, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Actions</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!item.assigneeId && item.status !== 'RESOLVED' && item.status !== 'CANCELLED' && (
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => claimMutation.mutate()}
                  disabled={claimMutation.isPending}
                >
                  Claim Work Item
                </button>
              )}

              {item.availableTransitions?.includes('IN_PROGRESS') && (
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => transitionMutation.mutate('IN_PROGRESS')}
                >
                  Start Work
                </button>
              )}

              {item.availableTransitions?.includes('PENDING_APPROVAL') && (
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => transitionMutation.mutate('PENDING_APPROVAL')}
                >
                  Submit for Approval
                </button>
              )}
              
              {item.status === 'PENDING_APPROVAL' && (
                <button 
                  className="btn btn-success" 
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => approveMutation.mutate()}
                >
                  Approve & Resolve
                </button>
              )}
              
              {item.availableTransitions?.includes('RESOLVED') && item.status !== 'PENDING_APPROVAL' && (
                <button 
                  className="btn btn-success" 
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => transitionMutation.mutate('RESOLVED')}
                >
                  Mark Resolved
                </button>
              )}

              {users && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Reassign</label>
                  <select 
                    className="form-input" 
                    value={item.assigneeId || ''}
                    onChange={(e) => assignMutation.mutate(e.target.value)}
                    disabled={assignMutation.isPending}
                    style={{ padding: '6px 12px', height: 'auto' }}
                  >
                    <option value="" disabled>Select user...</option>
                    {users.filter(u => u.teamMemberships.some(m => m.team.id === item.teamId)).map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              )}
              
              <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Change Priority</label>
                  <select 
                    className="form-input" 
                    value={item.priority}
                    onChange={(e) => priorityMutation.mutate(e.target.value)}
                    disabled={priorityMutation.isPending}
                    style={{ padding: '6px 12px', height: 'auto' }}
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>

              
              {item.availableTransitions?.includes('CANCELLED') && (
                <button 
                  className="btn btn-danger" 
                  style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
                  onClick={() => {
                    if (window.confirm('Are you sure you want to cancel this work item?')) {
                      transitionMutation.mutate('CANCELLED');
                    }
                  }}
                >
                  Cancel Work Item
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 14, marginBottom: 16, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Metadata</h3>
            <div style={{ fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Created by</span>
                <span>{item.createdBy.name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Created at</span>
                <span>{format(new Date(item.createdAt), 'MMM d, yyyy HH:mm')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Updated at</span>
                <span>{format(new Date(item.updatedAt), 'MMM d, yyyy HH:mm')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Version</span>
                <span style={{ fontFamily: 'monospace' }}>v{item.version}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 14, marginBottom: 16, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Activity</h3>
            <ul className="timeline">
              {activityData?.items.map(event => (
                <li key={event.id} className="timeline-item">
                  <div className="timeline-icon">
                    {event.eventType.includes('CREATE') ? '✨' : 
                     event.eventType.includes('STATUS') ? '🔄' : 
                     event.eventType.includes('ASSIGNEE') ? '👤' : 
                     event.eventType.includes('COMMENT') ? '💬' : 
                     event.eventType === 'APPROVED' ? '✅' :
                     event.eventType === 'REJECTED' ? '❌' : 
                     event.eventType === 'APPROVAL_REQUESTED' ? '⏳' : '📝'}
                  </div>
                  <div className="timeline-content">
                    <div>
                      <span className="timeline-actor">{event.actor.name}</span>{' '}
                      {event.eventType === 'STATUS_CHANGED' && `changed status to ${event.metadata.to}`}
                      {event.eventType === 'ASSIGNEE_CHANGED' && `assigned to ${event.metadata.toName || 'someone'}`}
                      {event.eventType === 'WORK_ITEM_CREATED' && 'created this item'}
                      {event.eventType === 'COMMENT_ADDED' && 'added a comment'}
                      {event.eventType === 'PRIORITY_CHANGED' && `changed priority to ${event.metadata.to}`}
                      {event.eventType === 'TITLE_CHANGED' && 'updated the title'}
                      {event.eventType === 'DESCRIPTION_CHANGED' && 'updated the description'}
                      {event.eventType === 'APPROVAL_REQUESTED' && 'submitted this item for approval'}
                      {event.eventType === 'APPROVED' && 'approved the work item'}
                      {event.eventType === 'REJECTED' && 'rejected the approval request'}
                    </div>
                    <div className="timeline-time">
                      {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
