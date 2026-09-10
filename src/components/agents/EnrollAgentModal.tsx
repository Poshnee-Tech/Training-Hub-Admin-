'use client';

/**
 * Agent enrollment form.
 *
 * Fills the gap that made this feel like a single-agent system: there was no
 * admin-side create at all, only public self-registration. Every submit creates
 * an independent agent record.
 *
 * Validation is inline and per-field rather than a single error at the top, and
 * the generated temporary password is shown once on success — it is bcrypt'd
 * server-side and cannot be retrieved later.
 */

import { useState } from 'react';
import { admin } from '@/lib/api';

/** Readable temp password: no ambiguous characters for someone reading it aloud. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

interface Props {
  token: string;
  onClose: () => void;
  onEnrolled: () => void;
}

type Errors = Partial<Record<'fullName' | 'email' | 'age' | 'trainingStartDate' | 'temporaryPassword', string>>;

export default function EnrollAgentModal({ token, onClose, onEnrolled }: Props) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    age: '',
    trainingStartDate: new Date().toISOString().split('T')[0],
    temporaryPassword: generatePassword(),
    employeeId: '',
    department: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [enrolled, setEnrolled] = useState<{ name: string; email: string; password: string } | null>(null);

  function validate(): boolean {
    const next: Errors = {};
    if (form.fullName.trim().length < 2) next.fullName = 'Enter the agent’s full name';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) next.email = 'Enter a valid email address';
    if (form.age) {
      const n = Number(form.age);
      if (!Number.isInteger(n) || n < 16 || n > 100) next.age = 'Age must be between 16 and 100';
    }
    if (!form.trainingStartDate) next.trainingStartDate = 'Pick a training start date';
    if (form.temporaryPassword.length < 8) next.temporaryPassword = 'At least 8 characters';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    if (!validate()) return;

    setSubmitting(true);
    try {
      await admin.enrollAgent(token, {
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        age: form.age ? Number(form.age) : undefined,
        trainingStartDate: form.trainingStartDate,
        temporaryPassword: form.temporaryPassword,
        employeeId: form.employeeId.trim() || undefined,
        department: form.department.trim() || undefined,
      });

      setEnrolled({
        name: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.temporaryPassword,
      });
      onEnrolled();
    } catch (err: any) {
      setSubmitError(err.message || 'Could not enroll this agent');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/50 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        {enrolled ? (
          <div className="p-6">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl">
              ✓
            </div>
            <h2 className="mt-4 text-center text-lg font-bold text-gray-900">{enrolled.name} is enrolled</h2>
            <p className="mt-1 text-center text-sm text-gray-500">
              Share these sign-in details. They&apos;ll be asked to choose their own password on first login.
            </p>

            <dl className="mt-5 space-y-2 rounded-lg bg-gray-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Email</dt>
                <dd className="font-medium text-gray-900 break-all">{enrolled.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Temporary password</dt>
                <dd className="font-mono font-semibold text-gray-900">{enrolled.password}</dd>
              </div>
            </dl>

            <p className="mt-3 rounded-lg bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
              This password won&apos;t be shown again — copy it now. You can issue a new one later from the
              agent&apos;s row.
            </p>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(`${enrolled.email} / ${enrolled.password}`)}
                className="btn-secondary flex-1"
              >
                Copy details
              </button>
              <button type="button" onClick={onClose} className="btn-primary flex-1">Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6">
            <h2 className="text-lg font-bold text-gray-900">Enroll an agent</h2>
            <p className="mt-1 text-sm text-gray-500">
              Creates a new agent with their own training progress.
            </p>

            <div className="mt-5 space-y-4">
              <Field label="Full name" error={errors.fullName} required>
                <input
                  type="text"
                  className="input"
                  placeholder="Jordan Ellis"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  suppressHydrationWarning
                />
              </Field>

              <Field label="Email" error={errors.email} required>
                <input
                  type="email"
                  className="input"
                  placeholder="jordan@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  suppressHydrationWarning
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Age" error={errors.age}>
                  <input
                    type="number"
                    min={16}
                    max={100}
                    className="input"
                    value={form.age}
                    onChange={(e) => setForm({ ...form, age: e.target.value })}
                    suppressHydrationWarning
                  />
                </Field>

                <Field label="Training start date" error={errors.trainingStartDate} required>
                  <input
                    type="date"
                    className="input"
                    value={form.trainingStartDate}
                    onChange={(e) => setForm({ ...form, trainingStartDate: e.target.value })}
                    suppressHydrationWarning
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Employee ID">
                  <input
                    type="text"
                    className="input"
                    placeholder="Optional"
                    value={form.employeeId}
                    onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                    suppressHydrationWarning
                  />
                </Field>

                <Field label="Department">
                  <input
                    type="text"
                    className="input"
                    placeholder="Optional"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    suppressHydrationWarning
                  />
                </Field>
              </div>

              <Field label="Temporary password" error={errors.temporaryPassword} required>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input font-mono flex-1"
                    value={form.temporaryPassword}
                    onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })}
                    suppressHydrationWarning
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, temporaryPassword: generatePassword() })}
                    className="btn-secondary shrink-0"
                  >
                    Regenerate
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  The agent must change this the first time they sign in.
                </p>
              </Field>
            </div>

            {submitError && (
              <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{submitError}</p>
            )}

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary flex-1">
                {submitting ? 'Enrolling…' : 'Enroll agent'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
