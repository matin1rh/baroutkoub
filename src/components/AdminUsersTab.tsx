import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  ShieldAlert,
  Unlock,
  Ban,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Edit3,
  X,
  Save
} from 'lucide-react';
import { ManagedUserRecord, SessionLockPolicy } from '../types';
import { getStoredAuthToken } from '../utils/matcher';

export const AdminUsersTab: React.FC = () => {
  const [users, setUsers] = useState<ManagedUserRecord[]>([]);
  const [sessionLockPolicy, setSessionLockPolicy] = useState<SessionLockPolicy>('STRICT_BLOCK');
  const [loading, setLoading] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Create New User State
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newSubPreset, setNewSubPreset] = useState<string>('30'); // '7', '30', '90', '365', '0', 'CUSTOM'
  const [newCustomDays, setNewCustomDays] = useState<string>('45');
  const [creating, setCreating] = useState(false);

  // Edit User Modal State
  const [editingUser, setEditingUser] = useState<ManagedUserRecord | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editSubPreset, setEditSubPreset] = useState<string>('KEEP'); // 'KEEP', '7', '30', '90', '365', '0', 'CUSTOM'
  const [editCustomDays, setEditCustomDays] = useState<string>('30');
  const [savingEdit, setSavingEdit] = useState(false);

  const showNotice = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ text, type });
    setTimeout(() => {
      setFeedback(null);
    }, 4000);
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const token = getStoredAuthToken();
      const res = await fetch('/api/admin/users', {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        if (data.sessionLockPolicy) {
          setSessionLockPolicy(data.sessionLockPolicy);
        }
      }
    } catch {
      showNotice('خطا در دریافت لیست کاربران', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handlePolicyChange = async (newPolicy: SessionLockPolicy) => {
    try {
      const token = getStoredAuthToken();
      const res = await fetch('/api/admin/settings/policy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ sessionLockPolicy: newPolicy })
      });
      if (res.ok) {
        setSessionLockPolicy(newPolicy);
        showNotice('سیاست نشست همزمان ذخیره شد.');
      }
    } catch {
      showNotice('خطا در تغییر سیاست نشست', 'error');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) {
      showNotice('نام کاربری و رمز عبور را وارد کنید.', 'error');
      return;
    }

    let finalSubDays = 0;
    if (newSubPreset === 'CUSTOM') {
      const parsed = parseInt(newCustomDays, 10);
      if (isNaN(parsed) || parsed <= 0) {
        showNotice('لطفاً تعداد روز معتبر وارد کنید.', 'error');
        return;
      }
      finalSubDays = parsed;
    } else {
      finalSubDays = parseInt(newSubPreset, 10);
    }

    setCreating(true);
    try {
      const token = getStoredAuthToken();
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          displayName: newDisplayName.trim() || newUsername.trim(),
          username: newUsername.trim(),
          password: newPassword.trim(),
          subscriptionDays: finalSubDays
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showNotice(data.error || 'خطا در ساخت کاربر', 'error');
        return;
      }

      setNewDisplayName('');
      setNewUsername('');
      setNewPassword('');
      setNewSubPreset('30');
      showNotice(`کاربر «${data.user.username}» ایجاد شد.`);
      fetchUsers();
    } catch {
      showNotice('خطا در ارتباط با سرور', 'error');
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (user: ManagedUserRecord) => {
    setEditingUser(user);
    setEditDisplayName(user.displayName);
    setEditUsername(user.username);
    setEditPassword('');
    setEditIsActive(user.isActive);
    setEditSubPreset('KEEP');
    setEditCustomDays(user.remainingDays && user.remainingDays > 0 ? String(user.remainingDays) : '30');
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    if (!editUsername.trim()) {
      showNotice('نام کاربری نمی‌تواند خالی باشد.', 'error');
      return;
    }

    const payload: Record<string, any> = {
      displayName: editDisplayName.trim() || editUsername.trim(),
      username: editUsername.trim(),
      isActive: editIsActive
    };

    if (editPassword.trim().length > 0) {
      if (editPassword.trim().length < 3) {
        showNotice('رمز عبور جدید باید حداقل ۳ کاراکتر باشد.', 'error');
        return;
      }
      payload.newPassword = editPassword.trim();
    }

    if (editingUser.role !== 'ADMIN' && editSubPreset !== 'KEEP') {
      if (editSubPreset === 'CUSTOM') {
        const parsed = parseInt(editCustomDays, 10);
        if (isNaN(parsed) || parsed <= 0) {
          showNotice('تعداد روز واردشده معتبر نیست.', 'error');
          return;
        }
        payload.setSubscriptionDays = parsed;
      } else {
        payload.setSubscriptionDays = parseInt(editSubPreset, 10);
      }
    }

    setSavingEdit(true);
    try {
      const token = getStoredAuthToken();
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        showNotice(data.error || 'خطا در ذخیره تغییرات کاربر', 'error');
        return;
      }

      showNotice(`مشخصات کاربر «${data.user.username}» بروزرسانی شد.`);
      setEditingUser(null);
      fetchUsers();
    } catch {
      showNotice('خطا در ارتباط با سرور', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleQuickUpdateUser = async (
    userId: string,
    payload: Record<string, any>,
    successMsg: string
  ) => {
    try {
      const token = getStoredAuthToken();
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        showNotice(data.error || 'خطا در عملیات', 'error');
        return;
      }

      showNotice(successMsg);
      fetchUsers();
    } catch {
      showNotice('خطا در ارتباط با سرور', 'error');
    }
  };

  const handleDeleteUser = async (user: ManagedUserRecord) => {
    try {
      const token = getStoredAuthToken();
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!res.ok) {
        const data = await res.json();
        showNotice(data.error || 'خطا در حذف کاربر', 'error');
        return;
      }

      showNotice(`کاربر «${user.username}» حذف شد.`);
      fetchUsers();
    } catch {
      showNotice('خطا در ارتباط با سرور', 'error');
    }
  };

  const formatJalaliDateTime = (iso: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('fa-IR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-6" id="admin-users-tab">
      {feedback && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl text-white text-xs sm:text-sm font-bold flex items-center gap-2.5 border ${
            feedback.type === 'success'
              ? 'bg-slate-900 border-emerald-500/60'
              : 'bg-rose-950 border-rose-500/60'
          }`}
        >
          <span>{feedback.text}</span>
        </div>
      )}

      {/* 1. Create New Customer + Session Policy Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="border-b border-slate-100 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-600" />
            تعریف مشتری جدید
          </h3>

          {/* Session Policy Toggle inside Create Customer Section */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5 text-blue-700" />
              سیاست جلوگیری از نشست همزمان:
            </span>
            <button
              type="button"
              onClick={() => handlePolicyChange('STRICT_BLOCK')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer whitespace-nowrap ${
                sessionLockPolicy === 'STRICT_BLOCK'
                  ? 'bg-blue-700 text-white border-blue-700'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
              id="btn-policy-strict"
            >
              مسدودسازی دستگاه دوم
            </button>
            <button
              type="button"
              onClick={() => handlePolicyChange('KICK_PREVIOUS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer whitespace-nowrap ${
                sessionLockPolicy === 'KICK_PREVIOUS'
                  ? 'bg-blue-700 text-white border-blue-700'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
              id="btn-policy-kick"
            >
              خروج خودکار دستگاه قبلی
            </button>
          </div>
        </div>

        <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              نام مشتری / شرکت
            </label>
            <input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="نام مشتری"
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              id="input-new-displayname"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              نام کاربری
            </label>
            <input
              type="text"
              dir="ltr"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Username"
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              id="input-new-username"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              رمز عبور
            </label>
            <input
              type="text"
              dir="ltr"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              id="input-new-password"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              مدت اعتبار اشتراک
            </label>
            <div className="flex items-center gap-1.5">
              <select
                value={newSubPreset}
                onChange={(e) => setNewSubPreset(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                id="select-new-subdays"
              >
                <option value="7">۷ روزه</option>
                <option value="30">یک‌ماهه (۳۰ روز)</option>
                <option value="90">سه‌ماهه (۹۰ روز)</option>
                <option value="365">یک‌ساله (۳۶۵ روز)</option>
                <option value="0">دائمی</option>
                <option value="CUSTOM">وارد کردن روز (عدد)</option>
              </select>

              {newSubPreset === 'CUSTOM' && (
                <input
                  type="number"
                  min={1}
                  dir="ltr"
                  value={newCustomDays}
                  onChange={(e) => setNewCustomDays(e.target.value)}
                  placeholder="روز"
                  className="w-20 px-2 py-2 text-xs font-mono font-bold bg-white border border-blue-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-center shrink-0"
                  id="input-new-custom-days"
                />
              )}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={creating}
              className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer h-[34px]"
              id="btn-create-user"
            >
              <UserPlus className="w-4 h-4" />
              <span>{creating ? 'در حال ثبت...' : 'ایجاد مشتری'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* 2. Users & Subscriptions Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-700" />
            <h3 className="text-sm font-bold text-slate-900">
              فهرست کاربران و اشتراک‌ها ({users.length.toLocaleString('fa-IR')})
            </h3>
          </div>

          <button
            type="button"
            onClick={fetchUsers}
            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>بروزرسانی</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/80 text-slate-700 border-b border-slate-200 font-bold">
                <th className="p-3">نام مشتری / شرکت</th>
                <th className="p-3">نام کاربری</th>
                <th className="p-3">وضعیت حساب</th>
                <th className="p-3">اعتبار اشتراک</th>
                <th className="p-3">وضعیت نشست</th>
                <th className="p-3 text-center">تغییر و ویرایش کاربر</th>
                <th className="p-3 text-center">امنیت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {users.map((u) => {
                const isAdmin = u.role === 'ADMIN';

                return (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-bold text-slate-900">
                      {u.displayName}
                      {isAdmin && (
                        <span className="mr-2 text-[11px] font-normal text-blue-700">
                          · مدیر کل
                        </span>
                      )}
                    </td>

                    <td className="p-3 font-mono font-bold text-slate-700" dir="ltr">
                      {u.username}
                    </td>

                    <td className="p-3">
                      {!u.isActive ? (
                        <span className="text-rose-700 font-bold flex items-center gap-1">
                          <Ban className="w-3.5 h-3.5" />
                          مسدود
                        </span>
                      ) : u.isExpired ? (
                        <span className="text-amber-700 font-bold">
                          منقضی شده
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          فعال
                        </span>
                      )}
                    </td>

                    <td className="p-3 font-mono tabular-nums">
                      {isAdmin || u.expiresAt === null ? (
                        <span className="text-slate-600 font-bold">دائمی</span>
                      ) : u.remainingDays !== null && u.remainingDays > 0 ? (
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-800">
                            {u.remainingDays.toLocaleString('fa-IR')} روز
                          </div>
                          <div className="text-[11px] text-slate-500">
                            تا {formatJalaliDateTime(u.expiresAt)}
                          </div>
                        </div>
                      ) : (
                        <div className="text-rose-600 font-bold">
                          پایان اعتبار ({formatJalaliDateTime(u.expiresAt)})
                        </div>
                      )}
                    </td>

                    <td className="p-3">
                      {u.hasActiveSession ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span className="font-bold text-emerald-800">آنلاین</span>
                          </div>
                          {!isAdmin && (
                            <button
                              type="button"
                              onClick={() =>
                                handleQuickUpdateUser(
                                  u.id,
                                  { unlockSession: true },
                                  `قفل نشست «${u.username}» آزاد شد.`
                                )
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:text-amber-900 underline cursor-pointer"
                            >
                              <Unlock className="w-3 h-3" />
                              آزادسازی نشست
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">آزاد</span>
                      )}
                    </td>

                    {/* Edit User Column */}
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                        id={`btn-edit-user-${u.username}`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>ویرایش کاربر</span>
                      </button>
                    </td>

                    {/* Security Column (without Change Password button) */}
                    <td className="p-3 text-center">
                      {!isAdmin ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleQuickUpdateUser(
                                u.id,
                                { isActive: !u.isActive },
                                u.isActive
                                  ? `حساب «${u.username}» مسدود شد.`
                                  : `حساب «${u.username}» فعال شد.`
                              )
                            }
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                              u.isActive
                                ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {u.isActive ? 'مسدودسازی' : 'فعال‌سازی'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u)}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                            title="حذف کاربر"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit User Modal Form */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-blue-700" />
                ویرایش مشخصات کاربر ({editingUser.username})
              </h4>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditUser} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    نام مشتری / شرکت
                  </label>
                  <input
                    type="text"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    نام کاربری
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    رمز عبور جدید (در صورت نیاز به تغییر)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="خالی = بدون تغییر"
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                {editingUser.role !== 'ADMIN' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      وضعیت دسترسی حساب
                    </label>
                    <select
                      value={editIsActive ? 'ACTIVE' : 'BLOCKED'}
                      onChange={(e) => setEditIsActive(e.target.value === 'ACTIVE')}
                      className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="ACTIVE">فعال</option>
                      <option value="BLOCKED">مسدود</option>
                    </select>
                  </div>
                )}
              </div>

              {editingUser.role !== 'ADMIN' && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <label className="block text-xs font-bold text-slate-700">
                    مدت اعتبار اشتراک
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={editSubPreset}
                      onChange={(e) => setEditSubPreset(e.target.value)}
                      className="flex-1 px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="KEEP">حفظ اعتبار فعلی کاربر</option>
                      <option value="7">۷ روزه</option>
                      <option value="30">یک‌ماهه (۳۰ روز)</option>
                      <option value="90">سه‌ماهه (۹۰ روز)</option>
                      <option value="365">یک‌ساله (۳۶۵ روز)</option>
                      <option value="0">دائمی</option>
                      <option value="CUSTOM">وارد کردن روز (عدد)</option>
                    </select>

                    {editSubPreset === 'CUSTOM' && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number"
                          min={1}
                          dir="ltr"
                          value={editCustomDays}
                          onChange={(e) => setEditCustomDays(e.target.value)}
                          placeholder="تعداد روز"
                          className="w-24 px-2.5 py-2 text-xs font-mono font-bold bg-white border border-blue-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-center"
                        />
                        <span className="text-xs font-bold text-slate-600">روز</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs"
                  id="btn-save-edit-user"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingEdit ? 'در حال ذخیره...' : 'ذخیره تغییرات'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
