import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { v4 as uuidv4 } from 'uuid';
import { useState } from 'react';

const createSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(100, 'Title is too long'),
  description: z.string().optional(),
  teamId: z.string().min(1, 'Please select a team'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
});

type CreateFormValues = z.infer<typeof createSchema>;

export function CreateWorkItem() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  // Generate an idempotency key once when the component mounts
  const [idempotencyKey] = useState(() => uuidv4());

  const { data: teams, isLoading: loadingTeams } = useQuery({
    queryKey: ['teams'],
    queryFn: api.teams,
  });

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: api.me,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      priority: 'MEDIUM',
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateFormValues) => api.createWorkItem(
      {
        title: data.title as string,
        description: data.description,
        teamId: data.teamId as string,
        priority: data.priority as string,
      },
      idempotencyKey
    ),
    onSuccess: (newItem) => {
      showToast('Work item created', 'success');
      navigate(`/work-items/${newItem.id}`);
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  const onSubmit = (data: CreateFormValues) => {
    createMutation.mutate(data);
  };

  // Only show teams where the user is a manager or member (not viewer)
  const availableTeams = teams?.filter((team) =>
    currentUser?.teamMemberships.some(
      (m) => m.team.id === team.id && (m.role === 'MANAGER' || m.role === 'MEMBER')
    )
  );

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div className="page-header">
        <h2>Create Work Item</h2>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input
              type="text"
              className="form-input"
              placeholder="E.g., Review Q3 Financials"
              {...register('title')}
            />
            {errors.title && <div className="form-error">{errors.title.message}</div>}
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              placeholder="Provide details about the work required..."
              {...register('description')}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Team *</label>
              <select className="form-select" {...register('teamId')} disabled={loadingTeams}>
                <option value="">Select a team...</option>
                {availableTeams?.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              {errors.teamId && <div className="form-error">{errors.teamId.message}</div>}
              {availableTeams?.length === 0 && (
                <div className="form-error" style={{ color: 'var(--warning)' }}>
                  You do not have permission to create work items in any teams.
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Priority *</label>
              <select className="form-select" {...register('priority')}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigate(-1)}
              disabled={createMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createMutation.isPending || availableTeams?.length === 0}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Work Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
