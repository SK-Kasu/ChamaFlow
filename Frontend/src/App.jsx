import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Coins,
  CreditCard,
  Building2,
  HandCoins,
  LayoutDashboard,
  Leaf,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Settings,
  Sparkles,
  Landmark,
  Users,
  Wallet,
  Trash2,
  X,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const AUTH_STORAGE_KEY = 'chamaflow-auth-session';

const navigation = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Slot marketplace', icon: HandCoins },
  { label: 'My group', icon: Users },
];

const adminNavigation = [
  { label: 'Administration', icon: Landmark },
];

function createDemoData({
  groupId = 'demo-default',
  groupName = 'Mwangaza Chama',
  contributionAmount = 10000,
  frequency = 'monthly',
  startDate = new Date().toISOString().slice(0, 10),
  memberNames,
} = {}) {
  const names = memberNames || [
    'Amina Mwangi',
    'Brian Otieno',
    'Wanjiku Njeri',
    'Kevin Kiptoo',
    'Faith Achieng',
    'Daniel Mutua',
    'Grace Wambui',
    'Peter Kamau',
  ];
  const members = names.map((member, index) => {
    const details = typeof member === 'string' ? { name: member } : member;
    return {
    id: index + 1,
    name: details.name,
    role: index === 0 ? 'Administrator' : groupId === 'demo-default' && index === 1 ? 'Treasurer' : 'Member',
    registrationNumber: details.registrationNumber || '',
    phoneNumber: details.phoneNumber || '',
    location: details.location || '',
    email: details.email || '',
    trustScore: [96, 91, 88, 84, 93, 78, 89, 86][index],
    paid: groupId === 'demo-default' && ![3, 6].includes(index),
    };
  });
  const slots = members.map((member, index) => {
    const payoutDate = new Date(`${startDate}T12:00:00`);
    if (frequency === 'monthly') {
      const day = payoutDate.getDate();
      payoutDate.setDate(1);
      payoutDate.setMonth(payoutDate.getMonth() + index);
      const lastDay = new Date(payoutDate.getFullYear(), payoutDate.getMonth() + 1, 0).getDate();
      payoutDate.setDate(Math.min(day, lastDay));
    } else {
      payoutDate.setDate(payoutDate.getDate() + index * (frequency === 'biweekly' ? 14 : 7));
    }
    return {
      id: `${groupId}-slot-${index + 1}`,
      position: index + 1,
      amount: Number(contributionAmount) * members.length,
      payoutDate: payoutDate.toISOString().slice(0, 10),
      payoutDateLabel: new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' }).format(payoutDate),
      status: 'upcoming',
      isListed: index === 1 || index === 6,
      memberName: member.name,
    };
  });
  const paidContributions = members.filter((member) => member.paid).length;

  return {
    prototypeMode: true,
    group: {
      id: groupId,
      name: groupName,
      contributionAmount: Number(contributionAmount),
      cycleNumber: 1,
      frequency,
      startDate,
      memberCount: members.length,
    },
    summary: {
      memberCount: members.length,
      paidContributions,
      contributionProgress: Math.round((paidContributions / members.length) * 100),
      totalContributions: paidContributions * Number(contributionAmount),
      activeListings: slots.filter((slot) => slot.isListed).length,
      cycleNumber: 1,
    },
    members,
    slots,
    activity: groupId === 'demo-default' ? [
      { id: 1, type: 'contribution', title: 'Faith completed her monthly contribution', amount: 10000, timeLabel: 'Today, 9:42 AM' },
      { id: 2, type: 'contribution', title: 'Amina completed her monthly contribution', amount: 10000, timeLabel: 'Yesterday, 4:18 PM' },
      { id: 3, type: 'payout', title: 'Brian received his cycle payout', amount: 80000, timeLabel: 'Oct 10, 11:05 AM' },
    ] : [],
  };
}

function createDemoContributions(data) {
  return data.members.map((member, index) => ({
    id: `demo-${data.group.id}-${index + 1}`,
    memberId: member.id,
    memberName: member.name,
    periodNumber: data.summary.cycleNumber,
    amount: data.group.contributionAmount,
    dueDate: data.group.startDate,
    status: member.paid ? 'paid' : data.group.startDate < new Date().toISOString().slice(0, 10) ? 'late' : 'pending',
    paymentMethod: member.paid ? 'simulated' : 'manual',
    paidAt: member.paid ? `${data.group.startDate}T09:00:00.000Z` : null,
  }));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#174c39] text-white">
        <Leaf size={20} strokeWidth={2.4} />
      </div>
      <div>
        <p className="display-font text-[17px] font-extrabold tracking-[-0.06em] text-[#19382c]">
          chama<span className="text-[#67a77e]">flow</span>
        </p>
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8b968e]">
          save together
        </p>
      </div>
    </div>
  );
}

function Sidebar({ activePage, setActivePage, open, onClose, onManageGroups, group, groupCount, adminAccess, userName, userEmail, onAccountSettings }) {
  const visibleNavigation = [
    ...navigation,
    ...(adminAccess?.platformAdmin || adminAccess?.saccoAdmin ? adminNavigation : []),
  ];
  return (
    <>
      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-[#14271f]/30 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-[min(84vw,320px)] flex-col overflow-y-auto border-r border-[#e9ece5] bg-white px-5 py-6 transition-transform duration-300 ease-in-out lg:static lg:z-auto lg:w-[264px] lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-2">
          <Brand />
          <button
            aria-label="Close navigation"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-xl text-[#718077] hover:bg-[#f4f7f2] lg:hidden"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-10">
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9aa49d]">
            Workspace
          </p>
                <div className="mt-3 rounded-2xl border border-[#edf0e9] bg-[#fbfcf9] p-3">
                  <button
                    onClick={onManageGroups}
                    className="w-full text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#e4f0e6] text-xs font-bold text-[#357451]">
                        MK
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-[#26382e]">{group?.name || 'Savings chama'}</p>
                        <p className="mt-0.5 text-xs text-[#87928a]">{group?.memberCount || 0} members · {group?.frequency || 'monthly'}</p>
                      </div>
                      <ChevronDown size={15} className="text-[#849188]" />
                    </div>
                  </button>
                  <button onClick={onManageGroups} className="mt-2 flex items-center gap-2 px-1 text-[10px] font-bold text-[#4b825d] transition hover:text-[#245b38]">
                    <Plus size={13} /> {groupCount > 1 ? 'Switch or create a chama' : 'Create another chama'}
                  </button>
                </div>
        </div>
        <nav className="mt-8 flex-1">
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9aa49d]">
            Menu
          </p>
          <div className="mt-3 space-y-1">
            {visibleNavigation.map(({ label, icon: Icon }) => (
              <button
                key={label}
                onClick={() => {
                  setActivePage(label);
                  onClose();
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] font-semibold transition ${
                  activePage === label
                    ? 'bg-[#eaf3eb] text-[#276443]'
                    : 'text-[#78847c] hover:bg-[#f6f8f4] hover:text-[#293b31]'
                }`}
              >
                <Icon size={17} strokeWidth={2} />
                {label}
                {label === 'Slot marketplace' && (
                  <span className="ml-auto rounded-full bg-[#dcebe0] px-2 py-0.5 text-[10px] font-bold text-[#34734e]">
                    New
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="mb-3 mt-8 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9aa49d]">
            Your money
          </p>
          <div className="space-y-1">
            <button onClick={() => { setActivePage('Contributions'); onClose(); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] font-semibold transition ${activePage === 'Contributions' ? 'bg-[#eaf3eb] text-[#276443]' : 'text-[#78847c] hover:bg-[#f6f8f4]'}`}>
              <CreditCard size={17} />
              Contributions
            </button>
            <button onClick={() => { setActivePage('Trust profile'); onClose(); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] font-semibold transition ${activePage === 'Trust profile' ? 'bg-[#eaf3eb] text-[#276443]' : 'text-[#78847c] hover:bg-[#f6f8f4]'}`}>
              <ShieldCheck size={17} />
              Trust profile
            </button>
          </div>
        </nav>
        <div className="rounded-2xl bg-[#f6f8f3] p-4">
          <div className="flex items-center gap-2 text-[#3e7956]">
            <CircleHelp size={16} />
            <p className="text-xs font-bold">Need a hand?</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-[#87928a]">
            Your savings chama, a little more flexible.
          </p>
        </div>
        <div className="mt-5 flex items-center gap-3 border-t border-[#edf0e9] pt-5">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[#f2dfcb] text-xs font-bold text-[#79543a]">
            {initials(userName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-[#26382e]">{userName}</p>
            <p className="truncate text-[10px] text-[#8b968e]">{userEmail || (userName === 'Demo guest' ? 'Demo session' : 'ChamaFlow account')}</p>
          </div>
          <button aria-label="Open account settings" onClick={onAccountSettings} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#89938c] transition hover:bg-[#f3f6f1] hover:text-[#476b50]">
            <Settings size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}

function StatCard({ label, value, note, icon: Icon, accent, trend }) {
  return (
    <article className="rounded-2xl border border-[#e9ece5] bg-white p-5">
      <div className="flex items-start justify-between">
        <p className="text-[12px] font-semibold text-[#849087]">{label}</p>
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${accent}`}>
          <Icon size={17} />
        </span>
      </div>
      <p className="display-font mt-3 text-[25px] font-extrabold tracking-[-0.06em] text-[#20362a]">
        {value}
      </p>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#869189]">
        {trend && <ArrowUpRight size={13} className="text-[#4d9668]" />}
        <span>{note}</span>
      </div>
    </article>
  );
}

function MemberAvatar({ name, index }) {
  const colors = [
    'bg-[#e9dfd2] text-[#76563d]',
    'bg-[#dcece1] text-[#39714d]',
    'bg-[#e7e0f0] text-[#68528b]',
    'bg-[#f1e3d5] text-[#a56b40]',
    'bg-[#dce8ef] text-[#4c7187]',
  ];

  return (
    <span
      className={`grid h-8 w-8 place-items-center rounded-full border-2 border-white text-[10px] font-bold ${colors[index % colors.length]}`}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

function Dashboard({ data, userName, onMarketplace, onGroup, onActivity, period, setPeriod }) {
  const nextSlot = data.slots.find((slot) => slot.status === 'upcoming');
  const recentMembers = data.members.slice(0, 5);
  const now = new Date();
  const maxDays = period === 'This month' ? 31 : period === 'Next 3 months' ? 90 : Infinity;
  const upcomingSlots = data.slots
    .filter((slot) => {
      const daysAway = (new Date(`${slot.payoutDate}T00:00:00`) - new Date(now.toDateString())) / 86400000;
      return daysAway <= maxDays;
    })
    .slice(0, 4);
  const todayLabel = new Intl.DateTimeFormat('en-KE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  return (
    <>
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold text-[#88948b]">{todayLabel}</p>
          <h1 className="display-font mt-2 text-[27px] font-extrabold tracking-[-0.06em] text-[#20362a] sm:text-[32px]">
            Habari, {userName?.split(' ')[0] || 'there'} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-1 text-sm text-[#849087]">Here’s what’s happening in your chama.</p>
        </div>
        <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#e4e9e1] bg-white px-3.5 text-xs font-semibold text-[#526258]">
          <CalendarDays size={15} />
          <select
            aria-label="Payout schedule period"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="max-w-[150px] cursor-pointer appearance-none bg-transparent outline-none"
          >
            <option>This month</option>
            <option>Next 3 months</option>
            <option>All cycle</option>
          </select>
          <ChevronDown size={14} />
        </label>
      </div>

      {data.prototypeMode && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-[#dce9df] bg-[#f1f7f1] px-4 py-3 text-xs leading-5 text-[#52705c]">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-[#4c8962]" />
          {typeof data.group.id === 'string'
            ? 'Illustrative demo data. Payment and investment integrations are not enabled.'
            : 'Live chama records from the ChamaFlow database. M-Pesa contributions use sandbox-only provider checks; live collections, payouts, and investments are not enabled.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Contributions recorded"
          value={formatCurrency(data.summary.totalContributions)}
          note={`${data.summary.paidContributions} member records marked paid this cycle`}
          icon={Wallet}
          accent="bg-[#eaf3eb] text-[#43805a]"
        />
        <StatCard
          label="Next scheduled payout"
          value={formatCurrency(nextSlot?.amount)}
          note={nextSlot ? `${nextSlot.memberName} · ${nextSlot.payoutDateLabel}` : 'No payout scheduled'}
          icon={ArrowDownLeft}
          accent="bg-[#f5efe3] text-[#a47a39]"
        />
        <StatCard
          label="Contributions this month"
          value={`${data.summary.contributionProgress}%`}
          note={`${data.summary.paidContributions} of ${data.summary.memberCount} received`}
          icon={Coins}
          accent="bg-[#eaf0f5] text-[#52738a]"
          trend
        />
        <StatCard
          label="Active slot listings"
          value={String(data.summary.activeListings).padStart(2, '0')}
          note="From your chama"
          icon={HandCoins}
          accent="bg-[#f1eaf4] text-[#826293]"
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]">
        <section className="rounded-2xl border border-[#e9ece5] bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="display-font text-[17px] font-extrabold tracking-[-0.04em] text-[#24382b]">
                Your chama, at a glance
              </h2>
              <p className="mt-1 text-xs text-[#89948c]">{data.group.name} · Cycle {data.summary.cycleNumber}</p>
            </div>
            <button onClick={onGroup} className="flex items-center gap-1 text-xs font-bold text-[#4b825d] transition hover:text-[#245b38]">
              Chama details <ArrowRight size={14} />
            </button>
          </div>
          <div className="mt-6 rounded-xl bg-[#f7f8f4] p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-[#87938a]">Cycle contribution</p>
                <p className="display-font mt-1 text-xl font-extrabold tracking-[-0.05em] text-[#20362a]">
                  {formatCurrency(data.group.contributionAmount)}
                  <span className="ml-1 text-xs font-medium tracking-normal text-[#8a958c]">/ member</span>
                </p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2 text-right">
                <p className="text-[10px] font-semibold text-[#8a958c]">Group size</p>
                <p className="mt-0.5 text-sm font-bold text-[#34513e]">{data.summary.memberCount} people</p>
              </div>
            </div>
            <div className="mt-5">
              <div className="mb-2 flex justify-between text-[11px]">
                <span className="font-semibold text-[#617168]">Monthly contributions</span>
                <span className="font-bold text-[#417452]">{data.summary.contributionProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#e6ebe3]">
                <div
                  className="h-full rounded-full bg-[#4f9466] transition-all"
                  style={{ width: `${data.summary.contributionProgress}%` }}
                />
              </div>
              <p className="mt-2 text-[10px] text-[#939d95]">
                {data.summary.paidContributions} members have contributed this cycle
              </p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-[#eef0eb] pt-4">
            <div className="flex items-center">
              {recentMembers.map((member, index) => (
                <span key={member.id} className={index ? '-ml-2' : ''}>
                  <MemberAvatar name={member.name} index={index} />
                </span>
              ))}
              {data.summary.memberCount > recentMembers.length && (
                <span className="-ml-2 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-[#f0f2ed] text-[9px] font-bold text-[#728078]">
                  +{data.summary.memberCount - recentMembers.length}
                </span>
              )}
              <span className="ml-3 text-[11px] text-[#8a958c]">chama members</span>
            </div>
            <button
              onClick={onMarketplace}
              className="hidden items-center gap-1 text-[11px] font-bold text-[#4b825d] sm:flex"
            >
              Explore slots <ArrowRight size={13} />
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-[#e9ece5] bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="display-font text-[17px] font-extrabold tracking-[-0.04em] text-[#24382b]">
                Upcoming payouts
              </h2>
              <p className="mt-1 text-xs text-[#89948c]">A look at what’s next in line</p>
            </div>
            <button
              onClick={onMarketplace}
              aria-label="Open slot marketplace"
              className="grid h-8 w-8 place-items-center rounded-lg bg-[#f4f7f2] text-[#598168]"
            >
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="mt-4 divide-y divide-[#f0f2ed]">
            {upcomingSlots.map((slot, index) => (
              <div key={slot.id} className="flex items-center gap-3 py-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f5f7f3] text-xs font-bold text-[#68776c]">
                  {String(slot.position).padStart(2, '0')}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-[#3a4b3f]">{slot.memberName}</p>
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-[#929c94]">
                    <Clock3 size={11} /> {slot.payoutDateLabel}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {index === 0 && (
                    <span className="mb-1 inline-block rounded-full bg-[#e9f3eb] px-2 py-0.5 text-[8px] font-bold text-[#43805a]">
                      NEXT
                    </span>
                  )}
                  <p className="text-xs font-bold text-[#344b39]">{formatCurrency(slot.amount)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1fr]">
        <section className="relative min-w-0 overflow-hidden rounded-2xl bg-[#1c4a36] p-5 text-white sm:p-6">
          <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full border border-white/10" />
          <div className="absolute -right-2 -top-8 h-32 w-32 rounded-full border border-white/10" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[#c6ddca]">
                <Sparkles size={15} />
                <p className="text-[10px] font-bold uppercase tracking-[0.14em]">A little extra</p>
              </div>
              <h2 className="display-font mt-3 text-lg font-extrabold tracking-[-0.04em]">
                Your patience has potential.
              </h2>
              <p className="mt-2 max-w-sm text-xs leading-5 text-[#d0e0d3]/75">
                ChamaFlow is exploring ways for eligible idle balances to earn a bonus for the chama.
              </p>
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-semibold text-[#d6e6d9]">
                <ShieldCheck size={11} /> Simulation only · No live investments
              </p>
            </div>
            <div className="hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 text-[#d3e9d6] sm:grid">
              <Leaf size={23} />
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-[#e9ece5] bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="display-font text-[17px] font-extrabold tracking-[-0.04em] text-[#24382b]">
                Recent activity
              </h2>
              <p className="mt-1 text-xs text-[#89948c]">Updates from your chama</p>
            </div>
            <button onClick={onActivity} className="text-[11px] font-bold text-[#4b825d] transition hover:text-[#245b38]">See all</button>
          </div>
          <div className="mt-4 space-y-4">
            {data.activity.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#edf4ee] text-[#518062]">
                  {item.type === 'payout' ? <ArrowDownLeft size={15} /> : <Check size={15} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold text-[#405147]">{item.title}</p>
                  <p className="mt-0.5 text-[10px] text-[#929c94]">{item.timeLabel}</p>
                </div>
                <p className="text-[11px] font-bold text-[#476b50]">{item.amount ? formatCurrency(item.amount) : 'Done'}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Marketplace({ data, onOpenRequest, searchTerm }) {
  const [filter, setFilter] = useState('All slots');
  const filters = ['All slots', 'Next 30 days', 'Later in cycle'];
  const query = searchTerm.trim().toLocaleLowerCase();
  const listings = data.slots.filter((slot) => {
    if (!slot.isListed) return false;
    if (query && !slot.memberName.toLocaleLowerCase().includes(query)) return false;
    if (filter === 'All slots') return true;

    const daysAway = (new Date(`${slot.payoutDate}T00:00:00`) - new Date(new Date().toDateString())) / 86400000;
    return filter === 'Next 30 days' ? daysAway <= 30 : daysAway > 30;
  });
  return (
    <div>
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold text-[#88948b]">{data.group.name}</p>
          <h1 className="display-font mt-2 text-[27px] font-extrabold tracking-[-0.06em] text-[#20362a] sm:text-[32px]">
            Slot marketplace
          </h1>
          <p className="mt-1 text-sm text-[#849087]">Explore payout positions listed by your chama.</p>
        </div>
        <button onClick={() => onOpenRequest({ kind: 'list' })} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#20543b] px-4 text-xs font-bold text-white transition hover:bg-[#173f2c]">
          <HandCoins size={15} /> List my slot
        </button>
      </div>
      <div className="mb-5 rounded-xl border border-[#e4eadd] bg-[#f1f7f1] px-4 py-3 text-xs leading-5 text-[#55705e]">
        Prototype marketplace: transfers and payments are not processed. A real slot transfer would require chama rules and member approval.
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {filters.map((filterOption) => (
          <button
            key={filterOption}
            aria-pressed={filter === filterOption}
            onClick={() => setFilter(filterOption)}
            className={`rounded-full px-4 py-2 text-[11px] font-semibold transition ${
              filter === filterOption ? 'bg-[#20543b] text-white' : 'border border-[#e4e9e1] bg-white text-[#748078] hover:bg-[#f4f7f2]'
            }`}
          >
            {filterOption}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {listings.map((slot, index) => (
          <article key={slot.id} className="rounded-2xl border border-[#e9ece5] bg-white p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <MemberAvatar name={slot.memberName} index={index} />
                <div>
                  <p className="text-sm font-bold text-[#34483a]">{slot.memberName}</p>
                  <p className="mt-0.5 text-[10px] text-[#909a92]">Payout slot #{slot.position}</p>
                </div>
              </div>
              <span className="rounded-full bg-[#f5f2e9] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-[#96763e]">
                Listed
              </span>
            </div>
            <div className="mt-5 rounded-xl bg-[#f7f8f4] p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-[#8b968e]">Payout amount</p>
                <CalendarDays size={14} className="text-[#8b968e]" />
              </div>
              <p className="display-font mt-1 text-[24px] font-extrabold tracking-[-0.05em] text-[#20362a]">
                {formatCurrency(slot.amount)}
              </p>
              <p className="mt-1 text-[11px] text-[#7f8b82]">Scheduled for {slot.payoutDateLabel}</p>
            </div>
            <div className="mt-4 flex items-center justify-between border-b border-[#eef0eb] pb-4 text-[10px]">
              <span className="text-[#929c94]">Cycle obligation</span>
              <span className="font-semibold text-[#58665d]">Continues per chama rules</span>
            </div>
            <button
              onClick={() => onOpenRequest(slot)}
              className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#dfe8df] text-xs font-bold text-[#427251] transition hover:bg-[#f3f7f2]"
            >
              Request details <ArrowRight size={14} />
            </button>
          </article>
        ))}
      </div>
      {listings.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#dfe5dc] bg-white p-12 text-center">
          <Search className="mx-auto text-[#92a096]" size={24} />
          <p className="mt-3 text-sm font-bold text-[#405147]">{query ? 'No matching slots' : 'No active listings yet'}</p>
          <p className="mt-1 text-xs text-[#89948c]">{query ? 'Try another member name or clear your search.' : 'Check back later for slots shared by your chama.'}</p>
        </div>
      )}
    </div>
  );
}

function RequestModal({ slot, onClose }) {
  if (!slot) return null;
  const isListing = slot.kind === 'list';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#14271f]/40 p-4" role="presentation" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-title"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#eaf3eb] text-[#43805a]">
            <HandCoins size={19} />
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="text-[#87928a]">
            <X size={18} />
          </button>
        </div>
        <h2 id="request-title" className="display-font mt-4 text-lg font-extrabold text-[#24382b]">
          {isListing ? 'List a payout slot' : 'Slot transfer preview'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#7d8980]">
          {isListing
            ? 'Creating a live listing is not connected yet. When enabled, you will be able to propose a payout slot for your chama to review.'
            : `${slot.memberName}’s payout slot #${slot.position} is scheduled for ${slot.payoutDateLabel}. Its listed amount is ${formatCurrency(slot.amount)}.`}
        </p>
        <div className="mt-4 rounded-xl bg-[#f5f7f3] p-3 text-xs leading-5 text-[#68776c]">
          {isListing
            ? 'This is a preview only. No slot has been listed, no transfer is created, and no money moves.'
            : 'This prototype does not create a transfer or move money. A production flow must define chama approval and contribution responsibility first.'}
        </div>
        <button
          onClick={onClose}
          className="mt-5 h-10 w-full rounded-xl bg-[#20543b] text-xs font-bold text-white"
        >
          Got it
        </button>
      </section>
    </div>
  );
}

function InfoModal({ dialog, onClose }) {
  if (!dialog) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#14271f]/40 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="info-dialog-title"
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="info-dialog-title" className="display-font text-lg font-extrabold text-[#24382b]">
            {dialog.title}
          </h2>
          <button onClick={onClose} aria-label="Close dialog" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#87928a] transition hover:bg-[#f3f6f1]">
            <X size={17} />
          </button>
        </div>
        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#7d8980]">{dialog.description}</p>
        <button onClick={onClose} className="mt-5 h-10 w-full rounded-xl bg-[#20543b] text-xs font-bold text-white transition hover:bg-[#173f2c]">
          Got it
        </button>
      </section>
    </div>
  );
}

function AccountSettingsPage({ user, accessToken, demoMode, onUserUpdated, onSignOut }) {
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileStatus, setProfileStatus] = useState('');
  const [passwordStatus, setPasswordStatus] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError('');
    setProfileStatus('');
    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ fullName, email }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not update your account details.');
      onUserUpdated(payload.user);
      setFullName(payload.user.fullName);
      setEmail(payload.user.email);
      setProfileStatus('Your account details have been saved.');
    } catch (saveError) {
      setProfileError(saveError.message || 'Could not update your account details.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    setSavingPassword(true);
    setPasswordError('');
    setPasswordStatus('');
    try {
      const response = await fetch(`${API_URL}/auth/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not update your password.');
      setCurrentPassword('');
      setNewPassword('');
      setPasswordStatus(payload.message || 'Password updated.');
    } catch (saveError) {
      setPasswordError(saveError.message || 'Could not update your password.');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs font-semibold text-[#88948b]">Your account</p>
      <h1 className="display-font mt-2 text-[27px] font-extrabold tracking-[-0.06em] text-[#20362a] sm:text-[32px]">Account settings</h1>
      <p className="mt-1 text-sm text-[#849087]">Manage your profile, password, and active sign-in.</p>
      {demoMode ? (
        <p className="mt-5 rounded-xl border border-[#e8e4d7] bg-[#fbf9f2] p-4 text-xs leading-5 text-[#81734f]">Account changes are available after signing in. Demo data and settings are temporary and are not saved to the database.</p>
      ) : (
        <>
          <section className="mt-6 rounded-2xl border border-[#e9ece5] bg-white p-4 sm:p-6">
            <h2 className="text-sm font-bold text-[#34483a]">Profile details</h2>
            <p className="mt-1 text-xs text-[#87928a]">Update the name and email address associated with your account.</p>
            <form onSubmit={saveProfile} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-[#526258]">
                Full name
                <input required minLength={2} maxLength={100} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#e4e9e1] px-3 text-sm font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
              </label>
              <label className="text-xs font-semibold text-[#526258]">
                Email address
                <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#e4e9e1] px-3 text-sm font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
              </label>
              <div className="sm:col-span-2">
                {profileError && <p role="alert" className="mb-3 rounded-lg bg-[#fbefec] px-3 py-2 text-xs text-[#a65347]">{profileError}</p>}
                {profileStatus && <p role="status" className="mb-3 rounded-lg bg-[#edf4ee] px-3 py-2 text-xs text-[#477352]">{profileStatus}</p>}
                <button disabled={savingProfile} className="h-10 rounded-xl bg-[#20543b] px-4 text-xs font-bold text-white disabled:opacity-60">{savingProfile ? 'Saving…' : 'Save profile'}</button>
              </div>
            </form>
          </section>
          <section className="mt-4 rounded-2xl border border-[#e9ece5] bg-white p-4 sm:p-6">
            <h2 className="text-sm font-bold text-[#34483a]">Password and sessions</h2>
            <p className="mt-1 text-xs leading-5 text-[#87928a]">Choose a password with at least 12 characters. Changing it signs out your other active sessions.</p>
            <form onSubmit={savePassword} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-[#526258]">
                Current password
                <input required type="password" maxLength={128} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#e4e9e1] px-3 text-sm font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
              </label>
              <label className="text-xs font-semibold text-[#526258]">
                New password
                <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#e4e9e1] px-3 text-sm font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
              </label>
              <div className="sm:col-span-2">
                {passwordError && <p role="alert" className="mb-3 rounded-lg bg-[#fbefec] px-3 py-2 text-xs text-[#a65347]">{passwordError}</p>}
                {passwordStatus && <p role="status" className="mb-3 rounded-lg bg-[#edf4ee] px-3 py-2 text-xs text-[#477352]">{passwordStatus}</p>}
                <button disabled={savingPassword} className="h-10 rounded-xl border border-[#dce5dc] px-4 text-xs font-bold text-[#466b50] disabled:opacity-60">{savingPassword ? 'Updating…' : 'Update password'}</button>
              </div>
            </form>
          </section>
        </>
      )}
      <section className="mt-4 flex flex-col gap-3 rounded-2xl border border-[#e9ece5] bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 className="text-sm font-bold text-[#34483a]">Sign out</h2>
          <p className="mt-1 text-xs text-[#87928a]">End this session on the current device.</p>
        </div>
        <button type="button" onClick={onSignOut} className="h-10 rounded-xl border border-[#e8d9d4] px-4 text-xs font-bold text-[#a65347] transition hover:bg-[#fbefec]">Sign out</button>
      </section>
    </div>
  );
}

function PaymentModal({ groupId, contribution, accessToken, onClose, onConfirmed }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [payment, setPayment] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!payment || ['succeeded', 'failed', 'reversed'].includes(payment.status)) return undefined;
    let cancelled = false;
    let timer;

    async function refreshPayment() {
      try {
        const response = await fetch(
          `${API_URL}/groups/${encodeURIComponent(groupId)}/contributions/${encodeURIComponent(contribution.id)}/payments/${encodeURIComponent(payment.id)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not refresh payment status.');
        if (cancelled) return;
        setPayment(payload.payment);
        setError('');
        if (payload.payment.status === 'succeeded') {
          await onConfirmed();
          return;
        }
        if (!['failed', 'reversed'].includes(payload.payment.status)) {
          timer = setTimeout(refreshPayment, 5000);
        }
      } catch (refreshError) {
        if (!cancelled) {
          setError(refreshError.message || 'Could not refresh payment status.');
          timer = setTimeout(refreshPayment, 10000);
        }
      }
    }

    timer = setTimeout(refreshPayment, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, contribution.id, groupId, onConfirmed, payment?.id, payment?.status]);

  async function startPayment(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        `${API_URL}/groups/${encodeURIComponent(groupId)}/contributions/${encodeURIComponent(contribution.id)}/payments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({ phoneNumber }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not start the sandbox payment.');
      setPayment(payload.payment);
    } catch (requestError) {
      setError(requestError.message || 'Could not start the sandbox payment.');
    } finally {
      setSubmitting(false);
    }
  }

  const paymentState = payment?.status === 'succeeded'
    ? 'Confirmed by Daraja sandbox'
    : payment?.status === 'failed'
      ? 'The sandbox provider reported that payment did not complete.'
      : payment?.status === 'verification_required'
        ? 'Being verified. Do not submit another payment for this contribution.'
        : payment
          ? 'Awaiting M-Pesa sandbox confirmation'
          : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#14271f]/40 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-dialog-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="payment-dialog-title" className="display-font text-lg font-extrabold text-[#24382b]">Pay contribution</h2>
            <p className="mt-1 text-xs text-[#87928a]">{contribution.memberName} · {formatCurrency(contribution.amount)}</p>
          </div>
          <button onClick={onClose} aria-label="Close payment dialog" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#87928a] transition hover:bg-[#f3f6f1]">
            <X size={17} />
          </button>
        </div>
        <p className="mt-4 rounded-xl border border-[#e8e4d7] bg-[#fbf9f2] px-3 py-2.5 text-[11px] leading-5 text-[#81734f]">
          Sandbox test only. No live funds are collected. The contribution will be marked paid only after the provider status is verified.
        </p>
        {!payment ? (
          <form onSubmit={startPayment} className="mt-4 space-y-3">
            <label className="block text-xs font-semibold text-[#526258]" htmlFor="payment-phone-number">M-Pesa phone number</label>
            <input
              id="payment-phone-number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="0712 345 678"
              className="h-11 w-full rounded-xl border border-[#e4e9e1] px-3 text-sm outline-none focus:border-[#83a78a]"
            />
            <button disabled={submitting} className="h-11 w-full rounded-xl bg-[#20543b] text-xs font-bold text-white disabled:cursor-wait disabled:opacity-60">
              {submitting ? 'Sending sandbox request…' : 'Send sandbox STK Push'}
            </button>
          </form>
        ) : (
          <div className="mt-4 rounded-xl bg-[#f5f7f3] p-4">
            <p role={payment.status === 'failed' ? 'alert' : 'status'} className="text-sm font-bold text-[#344b39]">{paymentState}</p>
            <p className="mt-2 text-[11px] text-[#77847b]">Support reference: {payment.accountReference}</p>
            {payment.failureReason && <p className="mt-2 text-[11px] leading-5 text-[#a65347]">{payment.failureReason}</p>}
            {payment.status === 'failed' && (
              <button onClick={() => setPayment(null)} className="mt-3 text-[11px] font-bold text-[#4b825d]">Start a new attempt</button>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-3 rounded-xl bg-[#fbefec] px-3 py-2 text-xs text-[#a65347]">{error}</p>}
        <button onClick={onClose} className="mt-4 h-10 w-full rounded-xl border border-[#dfe7dd] text-xs font-bold text-[#526c57]">
          {payment?.status === 'succeeded' || payment?.status === 'failed' ? 'Done' : 'Close'}
        </button>
      </section>
    </div>
  );
}

function AdminWorkspace({ accessToken, adminAccess, onCreateGroup, refreshKey }) {
  const [overview, setOverview] = useState(null);
  const [saccos, setSaccos] = useState([]);
  const [groups, setGroups] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saccoName, setSaccoName] = useState('');
  const [firstAdminEmail, setFirstAdminEmail] = useState('');
  const [administratorEmails, setAdministratorEmails] = useState({});
  const [groupNames, setGroupNames] = useState({});
  const [selectedSaccoId, setSelectedSaccoId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [groupDetails, setGroupDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [memberDrafts, setMemberDrafts] = useState({});

  async function request(path, options = {}) {
    const response = await fetch(`${API_URL}/admin${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'The administration request failed.');
    return payload;
  }

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [overviewPayload, saccoPayload, groupPayload, auditPayload] = await Promise.all([
        request('/overview'),
        request('/saccos'),
        request('/groups'),
        request('/audit'),
      ]);
      setOverview(overviewPayload);
      setSaccos(saccoPayload.saccos || []);
      setGroups(groupPayload.groups || []);
      setEvents(auditPayload.events || []);
      setSelectedSaccoId((current) => (
        (current && (saccoPayload.saccos || []).some((item) => String(item.id) === String(current) && item.status === 'active'))
          ? current
          : (saccoPayload.saccos?.find((item) => item.status === 'active')?.id
            ? String(saccoPayload.saccos.find((item) => item.status === 'active').id)
            : '')
      ));
    } catch (loadError) {
      setError(loadError.message || 'Could not load administration data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [accessToken, refreshKey]);

  async function runAction(action, successMessage) {
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      setNotice(successMessage);
    } catch (actionError) {
      setError(actionError.message || 'The administration change could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  const filteredGroups = groups.filter((group) => {
    const haystack = `${group.name} ${group.saccoName || ''}`.toLowerCase();
    return haystack.includes(searchTerm.toLowerCase());
  });
  const activeSaccos = saccos.filter((sacco) => sacco.status === 'active');

  async function toggleGroupDetails(groupId) {
    if (String(selectedGroupId) === String(groupId)) {
      setSelectedGroupId(null);
      setGroupDetails(null);
      setDetailsError('');
      return;
    }
    setSelectedGroupId(groupId);
    setGroupDetails(null);
    setDetailsError('');
    setDetailsLoading(true);
    try {
      const payload = await request(`/groups/${groupId}`);
      setGroupDetails(payload);
    } catch (loadError) {
      setDetailsError(loadError.message || 'Could not load group operations.');
    } finally {
      setDetailsLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold text-[#88948b]">Management workspace</p>
          <h1 className="display-font mt-2 text-2xl font-extrabold tracking-[-0.05em] text-[#20362a] sm:text-3xl">
            {adminAccess.platformAdmin ? 'Platform administration' : 'SACCO administration'}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#849087]">
            Coordinate SACCOs, savings groups, administrators, and operational follow-up.
          </p>
        </div>
        {saccos.length > 0 && (adminAccess.platformAdmin || adminAccess.saccoAdmin) && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {adminAccess.platformAdmin && (
              <select
                aria-label="SACCO for new group"
                value={selectedSaccoId}
                onChange={(event) => setSelectedSaccoId(event.target.value)}
                className="h-10 rounded-xl border border-[#e4e9e1] bg-white px-3 text-xs text-[#526258]"
              >
                {activeSaccos.map((sacco) => <option key={sacco.id} value={sacco.id}>{sacco.name}</option>)}
              </select>
            )}
            <button
              type="button"
              disabled={activeSaccos.length === 0 || submitting}
              onClick={() => onCreateGroup(selectedSaccoId || adminAccess.saccos?.[0]?.id || null)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#20543b] px-4 text-xs font-bold text-white transition hover:bg-[#173f2c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={15} /> Create savings group
            </button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="rounded-xl border border-[#f0d4ce] bg-[#fbefec] px-4 py-3 text-xs leading-5 text-[#a65347]">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-[#dce9df] bg-[#f1f7f1] px-4 py-3 text-xs leading-5 text-[#52705c]">{notice}</p>}

      {loading && !overview ? (
        <div className="grid min-h-48 place-items-center rounded-2xl border border-[#e9ece5] bg-white">
          <p className="text-xs font-semibold text-[#819087]">Loading administration data…</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              ['SACCOs', overview?.saccoCount ?? 0, Building2],
              ['Savings groups', overview?.groupCount ?? 0, Users],
              ['Members', overview?.memberCount ?? 0, Landmark],
              ['Open contribution records', overview?.openContributionCount ?? 0, CreditCard],
            ].map(([label, value, Icon]) => (
              <article key={label} className="rounded-2xl border border-[#e9ece5] bg-white p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold leading-4 text-[#849087] sm:text-xs">{label}</p>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#eaf3eb] text-[#43805a]"><Icon size={16} /></span>
                </div>
                <p className="display-font mt-3 text-2xl font-extrabold tracking-[-0.05em] text-[#20362a]">{value}</p>
              </article>
            ))}
          </div>

          {adminAccess.platformAdmin && (
            <article className="rounded-2xl border border-[#e9ece5] bg-white p-4 sm:p-5">
              <div className="mb-4">
                <h2 className="display-font text-base font-extrabold text-[#24382b]">Register a SACCO</h2>
                <p className="mt-1 text-xs leading-5 text-[#87928a]">Assign its first administrator to an existing ChamaFlow account.</p>
              </div>
              <form
                className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  void runAction(async () => {
                    await request('/saccos', {
                      method: 'POST',
                      body: JSON.stringify({ name: saccoName, adminEmail: firstAdminEmail }),
                    });
                    setSaccoName('');
                    setFirstAdminEmail('');
                    form.reset();
                  }, 'SACCO registered and administrator assigned.');
                }}
              >
                <input required minLength={2} maxLength={120} value={saccoName} onChange={(event) => setSaccoName(event.target.value)} placeholder="SACCO name" className="h-11 min-w-0 rounded-xl border border-[#e4e9e1] px-3 text-sm outline-none focus:border-[#83a78a]" />
                <input required type="email" value={firstAdminEmail} onChange={(event) => setFirstAdminEmail(event.target.value)} placeholder="First administrator email" className="h-11 min-w-0 rounded-xl border border-[#e4e9e1] px-3 text-sm outline-none focus:border-[#83a78a]" />
                <button disabled={submitting} className="h-11 rounded-xl bg-[#20543b] px-4 text-xs font-bold text-white disabled:opacity-60">Register SACCO</button>
              </form>
            </article>
          )}

          {saccos.length > 0 && (
            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="display-font text-lg font-extrabold text-[#24382b]">SACCOs</h2>
                  <p className="mt-1 text-xs text-[#87928a]">{adminAccess.platformAdmin ? 'Platform-wide organizations and administrator assignments.' : 'Your organization and its administration.'}</p>
                </div>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {saccos.map((sacco) => (
                  <article key={sacco.id} className="min-w-0 rounded-2xl border border-[#e9ece5] bg-white p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf3eb] text-[#43805a]"><Building2 size={18} /></span>
                        <div className="min-w-0">
                          <h3 className="truncate font-bold text-[#2c4033]">{sacco.name}</h3>
                          <p className="mt-0.5 text-[11px] text-[#87928a]">{sacco.status} · {sacco.groupCount} groups · {sacco.memberCount} members</p>
                        </div>
                      </div>
                      {adminAccess.platformAdmin && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void runAction(() => request(`/saccos/${sacco.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: sacco.status === 'active' ? 'suspended' : 'active' }),
                          }), `SACCO ${sacco.status === 'active' ? 'suspended' : 'reactivated'}.`)}
                          className={`rounded-lg px-3 py-2 text-[10px] font-bold ${sacco.status === 'active' ? 'bg-[#fbefec] text-[#a65347]' : 'bg-[#eaf3eb] text-[#43805a]'}`}
                        >
                          {sacco.status === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      )}
                    </div>
                    {adminAccess.platformAdmin && (
                      <>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {(sacco.administrators || []).map((administrator) => (
                            <span key={administrator.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-[#f4f7f2] py-1 pl-3 pr-1.5 text-[10px] text-[#526258]">
                              <span className="truncate">{administrator.fullName} · {administrator.email}</span>
                              {sacco.administratorCount > 1 && (
                                <button
                                  type="button"
                                  aria-label={`Remove ${administrator.email} as administrator`}
                                  disabled={submitting}
                                  onClick={() => void runAction(() => request(`/saccos/${sacco.id}/administrators/${administrator.id}`, { method: 'DELETE' }), 'SACCO administrator removed.')}
                                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[#a65347] hover:bg-[#fbefec]"
                                ><X size={12} /></button>
                              )}
                            </span>
                          ))}
                        </div>
                        <form
                          className="mt-4 flex flex-col gap-2 sm:flex-row"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const email = administratorEmails[sacco.id] || '';
                            void runAction(async () => {
                              await request(`/saccos/${sacco.id}/administrators`, {
                                method: 'POST',
                                body: JSON.stringify({ email }),
                              });
                              setAdministratorEmails((current) => ({ ...current, [sacco.id]: '' }));
                            }, 'SACCO administrator added.');
                          }}
                        >
                          <input required type="email" value={administratorEmails[sacco.id] || ''} onChange={(event) => setAdministratorEmails((current) => ({ ...current, [sacco.id]: event.target.value }))} placeholder="Add an existing user by email" className="h-10 min-w-0 flex-1 rounded-xl border border-[#e4e9e1] px-3 text-xs outline-none focus:border-[#83a78a]" />
                          <button disabled={submitting} className="h-10 rounded-xl border border-[#dce5dc] px-3 text-[10px] font-bold text-[#466b50] disabled:opacity-60">Add administrator</button>
                        </form>
                      </>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <h2 className="display-font text-lg font-extrabold text-[#24382b]">Savings groups</h2>
                <p className="mt-1 text-xs text-[#87928a]">Review group activity and manage lifecycle and SACCO assignment.</p>
              </div>
              <label className="flex h-10 items-center gap-2 rounded-xl border border-[#e4e9e1] bg-white px-3">
                <Search size={14} className="text-[#98a198]" />
                <input aria-label="Search SACCOs and groups" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search groups" className="w-full bg-transparent text-xs outline-none sm:w-48" />
              </label>
            </div>
            {filteredGroups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#dfe7dd] bg-white p-8 text-center">
                <Users className="mx-auto text-[#8aa28e]" size={24} />
                <p className="mt-3 text-sm font-bold text-[#34483a]">{groups.length ? 'No groups match your search' : 'No groups are assigned yet'}</p>
                <p className="mt-1 text-xs leading-5 text-[#87928a]">Create a group or ask a platform administrator to assign an existing group to a SACCO.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredGroups.map((group) => (
                  <article key={group.id} className="rounded-2xl border border-[#e9ece5] bg-white p-4 sm:p-5">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#809084]">{group.saccoName || 'Unassigned SACCO'}</p>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                          <input
                            aria-label={`Group ${group.name} name`}
                            value={groupNames[group.id] ?? group.name}
                            onChange={(event) => setGroupNames((current) => ({ ...current, [group.id]: event.target.value }))}
                            className="h-10 min-w-0 flex-1 rounded-xl border border-[#e4e9e1] px-3 text-sm font-semibold text-[#34483a] outline-none focus:border-[#83a78a]"
                          />
                          <button
                            type="button"
                            disabled={submitting || (groupNames[group.id] ?? group.name).trim() === group.name}
                            onClick={() => void runAction(() => request(`/groups/${group.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ name: groupNames[group.id] }),
                            }), 'Group name updated.')}
                            className="h-10 rounded-xl border border-[#dce5dc] px-3 text-[10px] font-bold text-[#466b50] disabled:opacity-40"
                          >Save name</button>
                        </div>
                        <p className="mt-2 text-[11px] text-[#87928a]">{group.memberCount} members · {formatCurrency(group.contributionAmount)} per cycle · {group.openContributionCount} open contribution records</p>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <select
                          aria-label={`Group ${group.name} lifecycle status`}
                          value={group.status}
                          disabled={submitting}
                          onChange={(event) => void runAction(() => request(`/groups/${group.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: event.target.value }),
                          }), 'Group status updated.')}
                          className="h-10 rounded-xl border border-[#e4e9e1] bg-white px-3 text-xs text-[#526258]"
                        >
                          <option value="active">Active</option>
                          <option value="completed">Completed</option>
                          <option value="archived">Archived</option>
                        </select>
                        {adminAccess.platformAdmin && (
                          <select
                            aria-label={`Assign ${group.name} to a SACCO`}
                            value={group.saccoId ?? ''}
                            disabled={submitting}
                            onChange={(event) => void runAction(() => request(`/groups/${group.id}/sacco`, {
                              method: 'PATCH',
                              body: JSON.stringify({ saccoId: event.target.value || null }),
                            }), 'Group SACCO assignment updated.')}
                            className="h-10 max-w-full rounded-xl border border-[#e4e9e1] bg-white px-3 text-xs text-[#526258]"
                          >
                            <option value="">Unassigned</option>
                            {saccos.filter((sacco) => sacco.status === 'active').map((sacco) => <option key={sacco.id} value={sacco.id}>{sacco.name}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-expanded={String(selectedGroupId) === String(group.id)}
                      onClick={() => void toggleGroupDetails(group.id)}
                      className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-[#f4f7f2] px-3 text-[10px] font-bold text-[#466b50] transition hover:bg-[#eaf3eb]"
                    >
                      <Users size={14} />
                      {String(selectedGroupId) === String(group.id) ? 'Hide operations' : 'View members and cycle'}
                    </button>
                    {String(selectedGroupId) === String(group.id) && (
                      <div className="mt-4 border-t border-[#eef0eb] pt-4">
                        {detailsLoading && <p className="text-xs text-[#87928a]">Loading group operations…</p>}
                        {detailsError && <p role="alert" className="mb-3 rounded-lg bg-[#fbefec] px-3 py-2 text-xs text-[#a65347]">{detailsError}</p>}
                        {groupDetails && (
                          <>
                            {group.status === 'active' && group.saccoStatus !== 'suspended' && (
                              <form
                                className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-[#edf0e9] bg-[#fbfcf9] p-3 sm:grid-cols-2 lg:grid-cols-3"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const member = memberDrafts[group.id] || {};
                                  void runAction(async () => {
                                    await request(`/groups/${group.id}/members`, {
                                      method: 'POST',
                                      body: JSON.stringify(member),
                                    });
                                    const payload = await request(`/groups/${group.id}`);
                                    setGroupDetails(payload);
                                    setMemberDrafts((current) => ({ ...current, [group.id]: {} }));
                                  }, 'Member added to the group.');
                                }}
                              >
                                <input
                                  required
                                  minLength={2}
                                  maxLength={100}
                                  value={memberDrafts[group.id]?.name || ''}
                                  onChange={(event) => setMemberDrafts((current) => ({ ...current, [group.id]: { ...current[group.id], name: event.target.value } }))}
                                  placeholder="Full name"
                                  aria-label="New group member name"
                                  className="h-10 min-w-0 rounded-lg border border-[#e4e9e1] px-3 text-xs outline-none focus:border-[#83a78a]"
                                />
                                <input
                                  maxLength={32}
                                  value={memberDrafts[group.id]?.registrationNumber || ''}
                                  onChange={(event) => setMemberDrafts((current) => ({ ...current, [group.id]: { ...current[group.id], registrationNumber: event.target.value } }))}
                                  placeholder="Reg. No."
                                  aria-label="Member registration number"
                                  className="h-10 min-w-0 rounded-lg border border-[#e4e9e1] px-3 text-xs outline-none focus:border-[#83a78a]"
                                />
                                <input
                                  type="tel"
                                  maxLength={24}
                                  value={memberDrafts[group.id]?.phoneNumber || ''}
                                  onChange={(event) => setMemberDrafts((current) => ({ ...current, [group.id]: { ...current[group.id], phoneNumber: event.target.value } }))}
                                  placeholder="Telephone"
                                  aria-label="Member telephone number"
                                  className="h-10 min-w-0 rounded-lg border border-[#e4e9e1] px-3 text-xs outline-none focus:border-[#83a78a]"
                                />
                                <input
                                  type="email"
                                  maxLength={254}
                                  value={memberDrafts[group.id]?.email || ''}
                                  onChange={(event) => setMemberDrafts((current) => ({ ...current, [group.id]: { ...current[group.id], email: event.target.value } }))}
                                  placeholder="Email (optional)"
                                  aria-label="Member email address"
                                  className="h-10 min-w-0 rounded-lg border border-[#e4e9e1] px-3 text-xs outline-none focus:border-[#83a78a]"
                                />
                                <input
                                  maxLength={120}
                                  value={memberDrafts[group.id]?.location || ''}
                                  onChange={(event) => setMemberDrafts((current) => ({ ...current, [group.id]: { ...current[group.id], location: event.target.value } }))}
                                  placeholder="Location"
                                  aria-label="Member location"
                                  className="h-10 min-w-0 rounded-lg border border-[#e4e9e1] px-3 text-xs outline-none focus:border-[#83a78a]"
                                />
                                <button disabled={submitting} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#20543b] px-3 text-[10px] font-bold text-white disabled:opacity-60 sm:col-span-2 lg:col-span-1">
                                  <Plus size={13} /> Add member
                                </button>
                              </form>
                            )}
                            <p className="mb-3 rounded-xl border border-[#e8e4d7] bg-[#fbf9f2] px-3 py-2 text-[10px] leading-5 text-[#81734f]">
                              Contribution and payout entries are internal prototype records. A recorded entry is not proof that money was received or disbursed.
                            </p>
                            <div className="grid gap-4 xl:grid-cols-3">
                              <div className="min-w-0">
                                <h3 className="mb-2 text-xs font-bold text-[#34483a]">Members · {groupDetails.members.length}</h3>
                                <div className="max-h-72 overflow-auto rounded-xl border border-[#eef0eb] bg-[#fafbf8]">
                                  <div className="grid min-w-[690px] grid-cols-[1.1fr_0.8fr_1fr_1fr_0.8fr] gap-3 border-b border-[#e9ece5] bg-white px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-[#929c94]">
                                    <span>Member</span><span>Reg. No.</span><span>Telephone</span><span>Email</span><span>Location</span>
                                  </div>
                                  {groupDetails.members.map((member) => (
                                    <div key={member.id} className="grid min-w-[690px] grid-cols-[1.1fr_0.8fr_1fr_1fr_0.8fr] gap-3 border-b border-[#f0f2ed] px-3 py-2.5 text-[10px] last:border-0">
                                      <p className="truncate font-semibold text-[#526258]">{member.name}<span className="ml-1 text-[9px] font-normal text-[#87928a]">{member.role}</span></p>
                                      <p className="truncate text-[#87928a]">{member.registrationNumber || '—'}</p>
                                      <p className="truncate text-[#87928a]">{member.phoneNumber || '—'}</p>
                                      <p className="truncate text-[#87928a]">{member.email || '—'}</p>
                                      <p className="truncate text-[#87928a]">{member.location || '—'}</p>
                                    </div>
                                  ))}
                                  {!groupDetails.members.length && <p className="p-3 text-[10px] text-[#87928a]">No members added.</p>}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <h3 className="mb-2 text-xs font-bold text-[#34483a]">Current cycle · {groupDetails.group.cycleNumber}</h3>
                                <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl bg-[#fafbf8] p-3">
                                  {groupDetails.contributions.map((item) => (
                                    <div key={item.id} className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="truncate text-[11px] font-semibold text-[#526258]">{item.memberName}</p>
                                        <p className="mt-0.5 text-[9px] text-[#87928a]">Due {item.dueDate} · {item.paymentMethod}</p>
                                      </div>
                                      <div className="shrink-0 text-right">
                                        <p className="text-[11px] font-semibold text-[#526258]">{formatCurrency(item.amount)}</p>
                                        <p className={`text-[9px] font-bold ${item.status === 'paid' ? 'text-[#43805a]' : item.status === 'late' ? 'text-[#a65347]' : 'text-[#9a773d]'}`}>{item.status}</p>
                                      </div>
                                    </div>
                                  ))}
                                  {groupDetails.contributions.length === 0 && <p className="text-[10px] text-[#87928a]">No contribution records.</p>}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <h3 className="mb-2 text-xs font-bold text-[#34483a]">Payout schedule</h3>
                                <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl bg-[#fafbf8] p-3">
                                  {groupDetails.payoutSlots.map((slot) => (
                                    <div key={slot.id} className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="truncate text-[11px] font-semibold text-[#526258]">#{slot.position} · {slot.memberName}</p>
                                        <p className="mt-0.5 text-[9px] text-[#87928a]">{slot.payoutDate}</p>
                                      </div>
                                      <div className="shrink-0 text-right">
                                        <p className="text-[11px] font-semibold text-[#526258]">{formatCurrency(slot.amount)}</p>
                                        <p className="text-[9px] font-bold text-[#9a773d]">{slot.status}{slot.status === 'paid' ? ' · simulated' : ''}</p>
                                      </div>
                                    </div>
                                  ))}
                                  {groupDetails.payoutSlots.length === 0 && <p className="text-[10px] text-[#87928a]">No payout slots scheduled.</p>}
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="display-font mb-3 text-lg font-extrabold text-[#24382b]">Administration activity</h2>
            <div className="overflow-hidden rounded-2xl border border-[#e9ece5] bg-white">
              {events.length === 0 ? (
                <p className="p-5 text-xs text-[#87928a]">Administrative changes will be listed here.</p>
              ) : events.map((event) => (
                <div key={event.id} className="flex flex-col gap-1 border-b border-[#eef0eb] px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-[#34483a]">{event.action.replaceAll('.', ' ')}{event.saccoName ? ` · ${event.saccoName}` : ''}</p>
                    <p className="mt-1 truncate text-[10px] text-[#87928a]">{event.actorName || 'Former user'} · {event.targetType} {event.targetId || ''}</p>
                  </div>
                  <time className="shrink-0 text-[10px] text-[#87928a]">{new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}</time>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function GroupManagerModal({ groups, selectedGroupId, onClose, onSelect, onCreate, defaultSaccoId }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [contributionAmount, setContributionAmount] = useState('1000');
  const [frequency, setFrequency] = useState('monthly');
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [memberRows, setMemberRows] = useState([
    { name: 'Your name', registrationNumber: '', phoneNumber: '', email: '', location: '' },
    { name: '', registrationNumber: '', phoneNumber: '', email: '', location: '' },
  ]);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const members = memberRows.map((member) => ({
    ...member,
    name: member.name.trim(),
    registrationNumber: member.registrationNumber.trim(),
    phoneNumber: member.phoneNumber.trim(),
    email: member.email.trim(),
    location: member.location.trim(),
  }));
  const updateMember = (index, field, value) => {
    setMemberRows((current) => current.map((member, rowIndex) => (
      rowIndex === index ? { ...member, [field]: value } : member
    )));
  };

  if (!groups) return null;

  async function submitGroup(event) {
    event.preventDefault();
    setFormError('');
    if (members.length < 2 || members.some((member) => member.name.length < 2)) {
      setFormError('Enter the names of at least two members.');
      return;
    }
    if (members.some((member) => member.name.length > 100 || member.registrationNumber.length > 32
      || member.phoneNumber.length > 24 || member.email.length > 254 || member.location.length > 120)) {
      setFormError('Check the member details and stay within the field length limits.');
      return;
    }
    setSubmitting(true);
    try {
      await onCreate({ name, contributionAmount, frequency, startDate, members, saccoId: defaultSaccoId || undefined });
      onClose();
    } catch (error) {
      setFormError(error.message || 'Could not create the savings group.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#14271f]/40 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="groups-dialog-title"
        className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#719079]">
              {creating ? 'New chama' : 'Workspace'}
            </p>
            <h2 id="groups-dialog-title" className="display-font mt-1 text-lg font-extrabold text-[#24382b]">
              {creating ? 'Create a savings group' : 'Your savings chamas'}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#87928a] transition hover:bg-[#f3f6f1]">
            <X size={17} />
          </button>
        </div>

        {creating ? (
          <form onSubmit={submitGroup} className="mt-4 space-y-3">
            <label className="block text-xs font-semibold text-[#526258]">
              Group name
              <input
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Mwangaza Chama"
                className="mt-1.5 h-11 w-full rounded-xl border border-[#e4e9e1] bg-white px-3 text-sm font-normal text-[#34483a] outline-none transition focus:border-[#83a78a]"
              />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-[#526258]">
                Contribution per member (KES)
                <input
                  required
                  type="number"
                  min="1"
                  max="9999999999"
                  step="0.01"
                  value={contributionAmount}
                  onChange={(event) => setContributionAmount(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-[#e4e9e1] px-3 text-sm font-normal text-[#34483a] outline-none transition focus:border-[#83a78a]"
                />
              </label>
              <label className="block text-xs font-semibold text-[#526258]">
                Contribution schedule
                <select
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-[#e4e9e1] bg-white px-3 text-sm font-normal text-[#34483a] outline-none transition focus:border-[#83a78a]"
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every two weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
            </div>
            <label className="block text-xs font-semibold text-[#526258]">
              Cycle start date
              <input
                required
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-[#e4e9e1] bg-white px-3 text-sm font-normal text-[#34483a] outline-none transition focus:border-[#83a78a] sm:max-w-xs"
              />
            </label>
            <section aria-labelledby="group-members-heading" className="rounded-xl border border-[#e9ece5] bg-[#fbfcf9] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 id="group-members-heading" className="text-xs font-bold text-[#34483a]">Member register and first-cycle contribution</h3>
                  <p className="mt-0.5 text-[10px] text-[#89948c]">Every member is assigned the group contribution amount above. First row is the administrator.</p>
                </div>
                <button
                  type="button"
                  disabled={memberRows.length >= 100}
                  onClick={() => setMemberRows((current) => [...current, { name: '', registrationNumber: '', phoneNumber: '', email: '', location: '' }])}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#dce5dc] bg-white px-3 text-[10px] font-bold text-[#466b50] disabled:opacity-50"
                >
                  <Plus size={13} /> Add row
                </button>
              </div>
              <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                {memberRows.map((member, index) => (
                  <fieldset key={index} className="grid grid-cols-2 gap-2 rounded-lg border border-[#edf0e9] bg-white p-2 sm:grid-cols-3 lg:grid-cols-[1.25fr_0.8fr_1fr_1.2fr_1fr_auto]">
                    <legend className="sr-only">Member {index + 1}{index === 0 ? ', group administrator' : ''}</legend>
                    <label className="col-span-2 text-[9px] font-semibold text-[#718077] sm:col-span-1">
                      {index === 0 ? 'Full name · Administrator' : 'Full name'}
                      <input
                        required
                        minLength={2}
                        maxLength={100}
                        value={member.name}
                        onChange={(event) => updateMember(index, 'name', event.target.value)}
                        placeholder="Member name"
                        autoComplete="name"
                        className="mt-1 h-9 w-full rounded-md border border-[#e4e9e1] px-2 text-[11px] font-normal text-[#34483a] outline-none focus:border-[#83a78a]"
                      />
                    </label>
                    <label className="text-[9px] font-semibold text-[#718077]">
                      Reg. No.
                      <input maxLength={32} value={member.registrationNumber} onChange={(event) => updateMember(index, 'registrationNumber', event.target.value)} placeholder="Optional" className="mt-1 h-9 w-full rounded-md border border-[#e4e9e1] px-2 text-[11px] font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
                    </label>
                    <label className="text-[9px] font-semibold text-[#718077]">
                      Telephone
                      <input type="tel" maxLength={24} value={member.phoneNumber} onChange={(event) => updateMember(index, 'phoneNumber', event.target.value)} placeholder="07xx xxx xxx" autoComplete="tel" className="mt-1 h-9 w-full rounded-md border border-[#e4e9e1] px-2 text-[11px] font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
                    </label>
                    <label className="col-span-2 text-[9px] font-semibold text-[#718077] sm:col-span-1">
                      Email
                      <input type="email" maxLength={254} value={member.email} onChange={(event) => updateMember(index, 'email', event.target.value)} placeholder="Optional" autoComplete="email" className="mt-1 h-9 w-full rounded-md border border-[#e4e9e1] px-2 text-[11px] font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
                    </label>
                    <label className="text-[9px] font-semibold text-[#718077]">
                      Location
                      <input maxLength={120} value={member.location} onChange={(event) => updateMember(index, 'location', event.target.value)} placeholder="Optional" className="mt-1 h-9 w-full rounded-md border border-[#e4e9e1] px-2 text-[11px] font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
                    </label>
                    <div className="flex items-end justify-end">
                      {memberRows.length > 2 && (
                        <button type="button" aria-label={`Remove member row ${index + 1}`} onClick={() => setMemberRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="grid h-9 w-9 place-items-center rounded-md text-[#89948c] hover:bg-[#fbefec] hover:text-[#a65347]">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </fieldset>
                ))}
              </div>
            </section>
            {formError && <p role="alert" className="rounded-xl bg-[#fbefec] px-3 py-2 text-xs text-[#a65347]">{formError}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" disabled={submitting} onClick={() => { setCreating(false); setFormError(''); }} className="h-11 flex-1 rounded-xl border border-[#e4e9e1] text-xs font-bold text-[#617168] transition hover:bg-[#f7f8f4] disabled:opacity-60">
                Back
              </button>
              <button type="submit" disabled={submitting} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#20543b] text-xs font-bold text-white transition hover:bg-[#173f2c] disabled:cursor-wait disabled:opacity-70">
                <Plus size={15} /> {submitting ? 'Creating…' : 'Create chama'}
              </button>
            </div>
            <p className="text-center text-[10px] text-[#929c94]">Demo groups stay in this browser session. Signed-in groups and member contributions are saved to PostgreSQL.</p>
          </form>
        ) : (
          <>
            <div className="mt-5 space-y-2">
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => { onSelect(group); onClose(); }}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition hover:bg-[#f8faf6] ${
                    String(group.id) === String(selectedGroupId) ? 'border-[#cbdcca] bg-[#f4f8f3]' : 'border-[#edf0e9]'
                  }`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e4f0e6] text-[#357451]">
                    <Users size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-[#34483a]">{group.name}</span>
                    <span className="mt-1 block text-[10px] text-[#89948c]">{group.memberCount || 0} members · {group.frequency || 'monthly'}</span>
                  </span>
                  {String(group.id) === String(selectedGroupId) && <Check size={16} className="text-[#43805a]" />}
                </button>
              ))}
            </div>
            <button onClick={() => setCreating(true)} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#20543b] text-xs font-bold text-white transition hover:bg-[#173f2c]">
              <Plus size={15} /> Create a savings group
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function GroupPage({ data, contributions, searchTerm, userEmail, onAddMember }) {
  const [memberDraft, setMemberDraft] = useState({ name: '', registrationNumber: '', phoneNumber: '', email: '', location: '' });
  const [addMemberError, setAddMemberError] = useState('');
  const [addMemberStatus, setAddMemberStatus] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const query = searchTerm.trim().toLocaleLowerCase();
  const members = data.members.filter((member) => member.name.toLocaleLowerCase().includes(query));
  const historyStats = new Map(data.members.map((member) => [member.id, contributionStats(member.id, contributions)]));
  const canManageMembers = Boolean(userEmail) && data.members.some((member) => (
    member.role === 'Administrator' && member.email?.toLocaleLowerCase() === userEmail?.toLocaleLowerCase()
  ));

  async function addMember(event) {
    event.preventDefault();
    setAddingMember(true);
    setAddMemberError('');
    setAddMemberStatus('');
    try {
      await onAddMember(memberDraft);
      setMemberDraft({ name: '', registrationNumber: '', phoneNumber: '', email: '', location: '' });
      setAddMemberStatus('Member and first-cycle contribution added.');
    } catch (error) {
      setAddMemberError(error.message || 'Could not add this member.');
    } finally {
      setAddingMember(false);
    }
  }

  return (
    <div>
      <p className="text-xs font-semibold text-[#88948b]">Your chama</p>
      <h1 className="display-font mt-2 text-[27px] font-extrabold tracking-[-0.06em] text-[#20362a] sm:text-[32px]">
        {data.group.name}
      </h1>
      <p className="mt-1 text-sm text-[#849087]">
        {data.summary.memberCount} members · {formatCurrency(data.group.contributionAmount)} {data.group.frequency || 'monthly'} contribution
      </p>
      {canManageMembers && (
        <form onSubmit={addMember} className="mt-5 rounded-2xl border border-[#e9ece5] bg-white p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#34483a]">Add a group member</h2>
              <p className="mt-1 text-[10px] text-[#87928a]">A contribution record for cycle {data.summary.cycleNumber} will be created automatically.</p>
            </div>
            <span className="rounded-full bg-[#edf4ee] px-2.5 py-1 text-[9px] font-bold text-[#4d795a]">{formatCurrency(data.group.contributionAmount)} per cycle</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-[10px] font-semibold text-[#718077]">
              Full name
              <input required minLength={2} maxLength={100} value={memberDraft.name} onChange={(event) => setMemberDraft((current) => ({ ...current, name: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-[#e4e9e1] px-3 text-xs font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
            </label>
            <label className="text-[10px] font-semibold text-[#718077]">
              Registration number
              <input maxLength={32} value={memberDraft.registrationNumber} onChange={(event) => setMemberDraft((current) => ({ ...current, registrationNumber: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-[#e4e9e1] px-3 text-xs font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
            </label>
            <label className="text-[10px] font-semibold text-[#718077]">
              Telephone number
              <input type="tel" maxLength={24} autoComplete="tel" value={memberDraft.phoneNumber} onChange={(event) => setMemberDraft((current) => ({ ...current, phoneNumber: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-[#e4e9e1] px-3 text-xs font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
            </label>
            <label className="text-[10px] font-semibold text-[#718077]">
              Email address
              <input type="email" maxLength={254} autoComplete="email" value={memberDraft.email} onChange={(event) => setMemberDraft((current) => ({ ...current, email: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-[#e4e9e1] px-3 text-xs font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
            </label>
            <label className="text-[10px] font-semibold text-[#718077]">
              Location
              <input maxLength={120} value={memberDraft.location} onChange={(event) => setMemberDraft((current) => ({ ...current, location: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-[#e4e9e1] px-3 text-xs font-normal text-[#34483a] outline-none focus:border-[#83a78a]" />
            </label>
            <button disabled={addingMember} className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#20543b] px-4 text-xs font-bold text-white disabled:opacity-60">
              <Plus size={14} /> {addingMember ? 'Adding…' : 'Add member'}
            </button>
          </div>
          {addMemberError && <p role="alert" className="mt-3 rounded-lg bg-[#fbefec] px-3 py-2 text-xs text-[#a65347]">{addMemberError}</p>}
          {addMemberStatus && <p role="status" className="mt-3 rounded-lg bg-[#edf4ee] px-3 py-2 text-xs text-[#477352]">{addMemberStatus}</p>}
        </form>
      )}
      <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-[#e9ece5] bg-white sm:block">
        <div className="min-w-[850px]">
          <div className="grid grid-cols-[1.2fr_0.8fr_1fr_1.2fr_0.9fr_auto_auto] gap-3 border-b border-[#eef0eb] px-4 py-3 text-[9px] font-bold uppercase tracking-wider text-[#929c94]">
            <span>Member</span><span>Reg. No.</span><span>Telephone</span><span>Email</span><span>Location</span><span>Cycle</span><span>History</span>
          </div>
          {members.map((member, index) => (
            <div key={member.id} className="grid grid-cols-[1.2fr_0.8fr_1fr_1.2fr_0.9fr_auto_auto] items-center gap-3 border-b border-[#f1f3ef] px-4 py-3 last:border-0">
              <div className="flex min-w-0 items-center gap-2">
                <MemberAvatar name={member.name} index={index} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-[#3a4b3f]">{member.name}</p>
                  <p className="mt-0.5 text-[9px] text-[#929c94]">{member.role}</p>
                </div>
              </div>
              <span className="truncate text-[10px] text-[#738076]">{member.registrationNumber || '—'}</span>
              <span className="truncate text-[10px] text-[#738076]">{member.phoneNumber || '—'}</span>
              <span className="truncate text-[10px] text-[#738076]">{member.email || '—'}</span>
              <span className="truncate text-[10px] text-[#738076]">{member.location || '—'}</span>
              <span className={`rounded-full px-2 py-1 text-center text-[9px] font-bold ${member.paid ? 'bg-[#eaf3eb] text-[#43805a]' : 'bg-[#f7f0e5] text-[#9a773d]'}`}>
                {member.paid ? 'Paid' : 'Pending'}
              </span>
              <span className="text-right text-xs font-bold text-[#526c57]">
                {historyStats.get(member.id).rate === null ? '—' : `${historyStats.get(member.id).rate}%`}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-6 space-y-3 sm:hidden">
        {members.map((member, index) => (
          <article key={member.id} className="rounded-2xl border border-[#e9ece5] bg-white p-4">
            <div className="flex min-w-0 items-center gap-3">
              <MemberAvatar name={member.name} index={index} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-[#3a4b3f]">{member.name}</p>
                <p className="mt-0.5 text-[10px] text-[#929c94]">{member.role}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold ${member.paid ? 'bg-[#eaf3eb] text-[#43805a]' : 'bg-[#f7f0e5] text-[#9a773d]'}`}>
                {member.paid ? 'Paid' : 'Pending'}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-[#f1f3ef] pt-3 text-[10px]">
              <span className="text-[#929c94]">Participation score</span>
              <span className="font-bold text-[#526c57]">
                {historyStats.get(member.id).rate === null ? 'Not enough data' : `${historyStats.get(member.id).rate}%`}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[#f1f3ef] pt-3 text-[10px]">
              {[
                ['Reg. No.', member.registrationNumber],
                ['Telephone', member.phoneNumber],
                ['Email', member.email],
                ['Location', member.location],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[#929c94]">{label}</dt>
                  <dd className="mt-0.5 truncate font-medium text-[#526258]">{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      {members.length === 0 && (
        <p className="mt-4 rounded-2xl border border-dashed border-[#dfe5dc] bg-white p-6 text-center text-xs text-[#89948c]">
          No members match “{searchTerm}”.
        </p>
      )}
      <p className="mt-3 text-[10px] text-[#8a958c]">On-time contribution history only. Not a lending or credit decision.</p>
    </div>
  );
}

function formatDate(value, includeTime = false) {
  if (!value) return '—';
  const date = new Date(includeTime ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-KE', includeTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function contributionStats(memberId, contributions) {
  const history = contributions.filter((item) => item.memberId === memberId);
  const paid = history.filter((item) => item.status === 'paid');
  const datedPaid = paid.filter((item) => item.paidAt);
  const onTime = datedPaid.filter((item) => item.paidAt.slice(0, 10) <= item.dueDate).length;
  return {
    total: history.length,
    paid: paid.length,
    onTime,
    late: datedPaid.length - onTime,
    unknownTiming: paid.length - datedPaid.length,
    overdue: history.filter((item) => item.status === 'late').length,
    pending: history.filter((item) => item.status === 'pending').length,
    rate: datedPaid.length ? Math.round((onTime / datedPaid.length) * 100) : null,
  };
}

function ContributionsPage({
  data,
  contributions,
  loading,
  error,
  demoMode,
  userEmail,
  recordingId,
  onRecord,
  searchTerm,
}) {
  const [filter, setFilter] = useState('All');
  const query = searchTerm.trim().toLocaleLowerCase();
  const memberById = new Map(data.members.map((member) => [member.id, member]));
  const currentMember = userEmail && data.members.find((member) => (
    member.email?.toLocaleLowerCase() === userEmail?.toLocaleLowerCase()
  ));
  const isGroupManager = ['Administrator', 'Treasurer'].includes(currentMember?.role);
  const visible = contributions
    .filter((item) => {
      const matchesQuery = !query || item.memberName.toLocaleLowerCase().includes(query);
      const matchesFilter = filter === 'All'
        || (filter === 'Paid' && item.status === 'paid')
        || (filter === 'Due' && ['pending', 'late'].includes(item.status));
      return matchesQuery && matchesFilter;
    })
    .sort((first, second) => second.dueDate.localeCompare(first.dueDate)
      || first.memberName.localeCompare(second.memberName));
  const cycleContributions = contributions.filter((item) => item.periodNumber === data.summary.cycleNumber);
  const paidCount = cycleContributions.filter((item) => item.status === 'paid').length;
  const dueCount = cycleContributions.filter((item) => ['pending', 'late'].includes(item.status)).length;
  const lateCount = cycleContributions.filter((item) => item.status === 'late').length;
  const paidTotal = cycleContributions
    .filter((item) => item.status === 'paid')
    .reduce((total, item) => total + Number(item.amount), 0);

  function canRecord(item) {
    if (item.status === 'paid' || item.status === 'waived') return false;
    if (['initiated', 'pending', 'verification_required'].includes(item.paymentStatus)) return false;
    const member = memberById.get(item.memberId);
    return demoMode || member?.id === currentMember?.id || isGroupManager;
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold text-[#88948b]">{data.group.name} · Cycle {data.summary.cycleNumber}</p>
          <h1 className="display-font mt-2 text-[27px] font-extrabold tracking-[-0.06em] text-[#20362a] sm:text-[32px]">
            Contributions
          </h1>
          <p className="mt-1 text-sm text-[#849087]">Review due dates and the recorded contribution history for your chama.</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#edf4ee] px-3 py-1.5 text-[10px] font-bold text-[#4d795a]">
          <ShieldCheck size={13} /> {demoMode ? 'Demo ledger · No money moves' : 'M-Pesa sandbox · Test transactions only'}
        </span>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Received this cycle', value: `${paidCount} / ${data.summary.memberCount}`, note: formatCurrency(paidTotal), icon: Check },
          { label: 'Still due', value: dueCount, note: 'Pending or overdue', icon: Clock3 },
          { label: 'Past due', value: lateCount, note: 'Needs follow-up', icon: CalendarDays },
          { label: 'Contribution amount', value: formatCurrency(data.group.contributionAmount), note: `Per member · ${data.group.frequency}`, icon: Wallet },
        ].map(({ label, value, note, icon: Icon }) => (
          <section key={label} className="rounded-2xl border border-[#e9ece5] bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#87938a]">{label}</p>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#edf4ee] text-[#4e805e]"><Icon size={15} /></span>
            </div>
            <p className="display-font mt-3 text-xl font-extrabold tracking-[-0.04em] text-[#263b2e]">{value}</p>
            <p className="mt-1 text-[10px] text-[#929c94]">{note}</p>
          </section>
        ))}
      </div>

      {demoMode && (
        <div className="mt-5 rounded-xl border border-[#e7e9d8] bg-[#fbfaf1] px-4 py-3 text-[11px] leading-5 text-[#7b7450]">
          Demo entries are temporary sample data for the current browser session. Recording a payment here does not collect or transfer money.
        </div>
      )}
      {error && <p role="alert" className="mt-4 rounded-xl bg-[#fbefec] px-4 py-3 text-xs text-[#a65347]">{error}</p>}

      <section className="mt-5 overflow-hidden rounded-2xl border border-[#e9ece5] bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-[#eef0eb] px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="display-font text-sm font-extrabold text-[#24382b]">Contribution history</h2>
            <p className="mt-1 text-[10px] text-[#929c94]">Sandbox confirmations are verified with Daraja; no live funds are collected.</p>
          </div>
          <div className="flex gap-1 rounded-xl bg-[#f5f7f3] p-1" role="group" aria-label="Filter contributions">
            {['All', 'Due', 'Paid'].map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                aria-pressed={filter === item}
                className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition ${filter === item ? 'bg-white text-[#376847] shadow-sm' : 'text-[#87938a] hover:text-[#42614a]'}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-xs font-semibold text-[#819087]">Loading contribution history…</div>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(150px,1.4fr)_0.7fr_0.8fr_0.8fr_1fr_auto] gap-3 border-b border-[#eef0eb] px-5 py-3 text-[9px] font-bold uppercase tracking-wider text-[#929c94] lg:grid">
              <span>Member</span><span>Cycle</span><span>Due date</span><span>Amount</span><span>Status</span><span>Action</span>
            </div>
            <div className="divide-y divide-[#f0f2ed]">
              {visible.map((item) => {
                const actionable = canRecord(item);
                const paymentInProgress = ['initiated', 'pending', 'verification_required'].includes(item.paymentStatus);
                const paymentFailed = item.paymentStatus === 'failed';
                const statusLabel = item.status === 'paid'
                  ? item.paymentMethod === 'mpesa_sandbox' ? 'Paid · sandbox verified' : item.paymentMethod === 'simulated' ? 'Paid · simulated' : 'Paid · recorded'
                  : paymentInProgress
                    ? item.paymentStatus === 'verification_required' ? 'Being verified' : 'Awaiting M-Pesa'
                    : paymentFailed ? 'Payment failed'
                    : item.status === 'late' ? 'Overdue' : item.status === 'waived' ? 'Waived' : 'Pending';
                return (
                  <article key={item.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(150px,1.4fr)_0.7fr_0.8fr_0.8fr_1fr_auto] lg:items-center">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#edf4ee] text-[10px] font-bold text-[#4e805e]">{initials(item.memberName)}</div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-[#3a4b3f]">{item.memberName}</p>
                        <p className="mt-0.5 text-[9px] text-[#929c94]">{item.status === 'paid' ? `Recorded ${formatDate(item.paidAt, true)}` : `Period ${item.periodNumber}`}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-[#738076] lg:text-xs">Cycle {item.periodNumber}</p>
                    <p className="text-[10px] text-[#738076] lg:text-xs">Due {formatDate(item.dueDate)}</p>
                    <p className="text-xs font-bold text-[#344b39]">{formatCurrency(item.amount)}</p>
                    <span className={`w-fit rounded-full px-2.5 py-1 text-[9px] font-bold ${item.status === 'paid' ? 'bg-[#eaf3eb] text-[#43805a]' : paymentInProgress ? 'bg-[#edf2f6] text-[#587188]' : paymentFailed || item.status === 'late' ? 'bg-[#fbefec] text-[#a65347]' : item.status === 'waived' ? 'bg-[#f2f3ef] text-[#7e8981]' : 'bg-[#f7f0e5] text-[#9a773d]'}`}>
                      {statusLabel}
                    </span>
                    {actionable ? (
                      <button
                        onClick={() => onRecord(item)}
                        disabled={recordingId === item.id}
                        className="w-fit rounded-lg bg-[#20543b] px-3 py-2 text-[10px] font-bold text-white transition hover:bg-[#173f2c] disabled:cursor-wait disabled:opacity-60"
                      >
                        {recordingId === item.id
                          ? 'Recording…'
                          : demoMode
                            ? 'Record simulated payment'
                            : isGroupManager && memberById.get(item.memberId)?.id !== currentMember?.id
                              ? 'Record internal payment'
                              : 'Pay with M-Pesa sandbox'}
                      </button>
                    ) : (
                      <span className="text-[10px] text-[#a0a9a1]">{item.status === 'paid' ? 'Complete' : paymentInProgress ? item.paymentReference : 'Member only'}</span>
                    )}
                  </article>
                );
              })}
              {visible.length === 0 && (
                <p className="p-8 text-center text-xs text-[#89948c]">
                  {contributions.length ? 'No contribution records match these filters.' : 'No contribution records yet.'}
                </p>
              )}
            </div>
          </>
        )}
      </section>
      <p className="mt-3 text-[10px] text-[#929c94]">{demoMode ? 'Demo recording updates temporary sample data only.' : 'Sandbox payment status is provider-verified for testing. It does not represent a live payment.'}</p>
    </div>
  );
}

function TrustProfilePage({ data, contributions, loading, error, demoMode, searchTerm }) {
  const query = searchTerm.trim().toLocaleLowerCase();
  const profiles = data.members
    .map((member) => ({ member, stats: contributionStats(member.id, contributions) }))
    .filter(({ member }) => member.name.toLocaleLowerCase().includes(query));
  const datedPaid = contributions.filter((item) => item.status === 'paid' && item.paidAt);
  const onTimeTotal = datedPaid.filter((item) => item.paidAt.slice(0, 10) <= item.dueDate).length;
  const overallRate = datedPaid.length ? Math.round((onTimeTotal / datedPaid.length) * 100) : null;

  return (
    <div>
      <p className="text-xs font-semibold text-[#88948b]">{data.group.name} · Contribution history</p>
      <h1 className="display-font mt-2 text-[27px] font-extrabold tracking-[-0.06em] text-[#20362a] sm:text-[32px]">Trust profile</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[#849087]">A transparent view of participation based only on contribution records in this chama.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className="relative overflow-hidden rounded-2xl bg-[#1c4a36] p-5 text-white sm:p-6">
          <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full border border-white/10" />
          <div className="relative flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10 text-[#d3e9d6]"><ShieldCheck size={22} /></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#c6ddca]">Chama payment punctuality</p>
              <p className="display-font mt-2 text-3xl font-extrabold tracking-[-0.05em]">{overallRate === null ? '—' : `${overallRate}%`}</p>
              <p className="mt-2 text-[11px] leading-5 text-[#d0e0d3]/80">
                {datedPaid.length ? `${onTimeTotal} of ${datedPaid.length} timestamped records were on or before their due date.` : 'A punctuality rate will appear after dated contribution records are available.'}
              </p>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-[#e9ece5] bg-white p-5 sm:p-6">
          <h2 className="display-font text-sm font-extrabold text-[#24382b]">How this profile works</h2>
          <div className="mt-3 space-y-2 text-[11px] leading-5 text-[#77847b]">
            <p><strong className="text-[#3e5745]">On-time rate</strong> = recorded contributions paid on or before their due date, divided by recorded payments.</p>
            <p>Pending, overdue, and waived contributions are shown separately. Paid records without timestamps are excluded from punctuality. No history is “not enough data,” not a low score.</p>
          </div>
        </section>
      </div>

      {demoMode && (
        <aside className="mt-4 flex items-start gap-3 rounded-2xl border border-[#e8e7d8] bg-[#fbfaf4] px-4 py-3.5 text-[#706b4d]" aria-label="Demo profile information">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-[#8b8053]"><CircleHelp size={14} /></span>
          <div>
            <p className="text-[11px] font-bold">Demonstration profile</p>
            <p className="mt-1 text-[10px] leading-5">
              These illustrative records are held for this browser session and are not written to the chama’s database. Participation metrics are informational only and are not used for credit, lending, or eligibility decisions.
            </p>
          </div>
        </aside>
      )}
      {error && <p role="alert" className="mt-4 rounded-xl bg-[#fbefec] px-4 py-3 text-xs text-[#a65347]">{error}</p>}
      <div className="mt-5 flex items-center justify-between">
        <div>
          <h2 className="display-font text-base font-extrabold text-[#24382b]">Member participation</h2>
          <p className="mt-1 text-[10px] text-[#929c94]">Based on all contribution records currently available.</p>
        </div>
        <span className="rounded-full bg-[#edf4ee] px-3 py-1.5 text-[10px] font-bold text-[#4d795a]">{data.members.length} members</span>
      </div>
      {loading ? (
        <div className="mt-4 rounded-2xl border border-[#e9ece5] bg-white p-8 text-center text-xs font-semibold text-[#819087]">Loading member history…</div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map(({ member, stats }, index) => (
            <article key={member.id} className="rounded-2xl border border-[#e9ece5] bg-white p-5">
              <div className="flex items-center gap-3">
                <MemberAvatar name={member.name} index={index} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-[#3a4b3f]">{member.name}</p>
                  <p className="mt-0.5 text-[10px] text-[#929c94]">{member.role}</p>
                </div>
                <div className="text-right">
                  <p className="display-font text-lg font-extrabold text-[#345c40]">{stats.rate === null ? '—' : `${stats.rate}%`}</p>
                  <p className="text-[8px] font-bold uppercase tracking-wide text-[#9aa39c]">on time</p>
                </div>
              </div>
              {stats.rate !== null && (
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#e9eee7]">
                  <div className="h-full rounded-full bg-[#5c9b6c]" style={{ width: `${stats.rate}%` }} />
                </div>
              )}
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[#f0f2ed] pt-3">
                <div><p className="text-sm font-bold text-[#344b39]">{stats.paid}</p><p className="mt-0.5 text-[9px] text-[#929c94]">paid</p></div>
                <div><p className="text-sm font-bold text-[#9a773d]">{stats.pending + stats.overdue}</p><p className="mt-0.5 text-[9px] text-[#929c94]">open</p></div>
                <div><p className="text-sm font-bold text-[#a65347]">{stats.late + stats.overdue}</p><p className="mt-0.5 text-[9px] text-[#929c94]">late</p></div>
              </div>
              <p className="mt-3 text-[9px] text-[#929c94]">
                {stats.total === 0 ? 'Not enough contribution history yet.' : `${stats.onTime} on-time of ${stats.paid - stats.unknownTiming} timestamped payment${stats.paid - stats.unknownTiming === 1 ? '' : 's'}.${stats.unknownTiming ? ` ${stats.unknownTiming} paid record${stats.unknownTiming === 1 ? '' : 's'} missing a timestamp.` : ''}`}
              </p>
            </article>
          ))}
          {profiles.length === 0 && <p className="rounded-2xl border border-dashed border-[#dfe5dc] bg-white p-6 text-center text-xs text-[#89948c]">No members match “{searchTerm}”.</p>}
        </div>
      )}
      <p className="mt-4 text-[10px] text-[#8a958c]">Participation information only. It is not a credit score, lending decision, or financial recommendation.</p>
    </div>
  );
}

function AnalyticsPage({ data, contributions, loading, error, demoMode, onContributions }) {
  const cycleContributions = contributions.filter((item) => item.periodNumber === data.summary.cycleNumber);
  const recorded = cycleContributions.filter((item) => item.status === 'paid');
  const outstanding = cycleContributions.filter((item) => ['pending', 'late'].includes(item.status));
  const overdue = cycleContributions.filter((item) => item.status === 'late');
  const expectedAmount = cycleContributions
    .filter((item) => item.status !== 'waived')
    .reduce((total, item) => total + Number(item.amount), 0);
  const recordedAmount = recorded.reduce((total, item) => total + Number(item.amount), 0);
  const outstandingAmount = outstanding.reduce((total, item) => total + Number(item.amount), 0);
  const collectionRate = expectedAmount ? Math.round((recordedAmount / expectedAmount) * 100) : 0;
  const cycles = [...new Set(contributions.map((item) => item.periodNumber))]
    .sort((a, b) => a - b)
    .slice(-6)
    .map((periodNumber) => {
      const items = contributions.filter((item) => item.periodNumber === periodNumber);
      const expected = items.filter((item) => item.status !== 'waived').reduce((sum, item) => sum + Number(item.amount), 0);
      const paid = items.filter((item) => item.status === 'paid').reduce((sum, item) => sum + Number(item.amount), 0);
      return {
        periodNumber,
        expected,
        paid,
        rate: expected ? Math.round((paid / expected) * 100) : 0,
      };
    });
  const listedSlots = data.slots.filter((slot) => slot.isListed).length;
  const completedSlots = data.slots.filter((slot) => slot.status === 'paid').length;
  const averagePaid = recorded.length ? recordedAmount / recorded.length : 0;

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold text-[#88948b]">{data.group.name} · Cycle {data.summary.cycleNumber}</p>
          <h1 className="display-font mt-2 text-[27px] font-extrabold tracking-[-0.06em] text-[#20362a] sm:text-[32px]">Business analytics</h1>
          <p className="mt-1 text-sm text-[#849087]">A clear operating view of collections, outstanding contributions, and payout activity.</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#edf4ee] px-3 py-1.5 text-[10px] font-bold text-[#4d795a]">
          <BarChart3 size={13} /> {demoMode ? 'Demonstration insights' : 'Database-backed insights'}
        </span>
      </div>

      {demoMode && (
        <div className="mt-5 rounded-xl border border-[#e7e9d8] bg-[#fbfaf1] px-4 py-3 text-[11px] leading-5 text-[#7b7450]">
          This view uses illustrative demo records. In a connected workspace, figures are calculated from the selected chama’s contribution and payout records.
        </div>
      )}
      {error && <p role="alert" className="mt-4 rounded-xl bg-[#fbefec] px-4 py-3 text-xs text-[#a65347]">{error}</p>}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Collection rate', value: `${collectionRate}%`, note: `${recorded.length} of ${cycleContributions.filter((item) => item.status !== 'waived').length} contribution records paid`, icon: Check },
          { label: 'Recorded this cycle', value: formatCurrency(recordedAmount), note: `${recorded.length} payment records`, icon: Wallet },
          { label: 'Outstanding', value: formatCurrency(outstandingAmount), note: `${outstanding.length} contribution${outstanding.length === 1 ? '' : 's'} still due`, icon: Clock3 },
          { label: 'Overdue', value: overdue.length, note: formatCurrency(overdue.reduce((total, item) => total + Number(item.amount), 0)), icon: CalendarDays },
        ].map(({ label, value, note, icon: Icon }) => (
          <section key={label} className="rounded-2xl border border-[#e9ece5] bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#87938a]">{label}</p>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#edf4ee] text-[#4e805e]"><Icon size={15} /></span>
            </div>
            <p className="display-font mt-3 text-xl font-extrabold tracking-[-0.04em] text-[#263b2e]">{value}</p>
            <p className="mt-1 text-[10px] text-[#929c94]">{note}</p>
          </section>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-[#e9ece5] bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="display-font text-base font-extrabold text-[#24382b]">Collection performance</h2>
              <p className="mt-1 text-[10px] text-[#929c94]">Contribution amount recorded as paid per cycle</p>
            </div>
            <span className="rounded-lg bg-[#f4f7f2] px-2.5 py-1.5 text-[9px] font-bold text-[#64806b]">Last {cycles.length} cycles</span>
          </div>
          {loading ? (
            <p className="py-16 text-center text-xs font-semibold text-[#819087]">Loading analytics…</p>
          ) : cycles.length ? (
            <div className="mt-7 flex h-48 items-end gap-3 border-b border-[#e9ece5] px-1 sm:gap-5">
              {cycles.map((cycle) => (
                <div key={cycle.periodNumber} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-[9px] font-bold text-[#526c57]">{cycle.rate}%</span>
                  <div className="flex h-36 w-full items-end justify-center rounded-t-lg bg-[#f4f7f2]">
                    <div
                      className="w-full max-w-12 rounded-t-lg bg-[#5c9b6c] transition-all"
                      style={{ height: `${Math.max(cycle.rate, 3)}%` }}
                      title={`${formatCurrency(cycle.paid)} recorded out of ${formatCurrency(cycle.expected)}`}
                    />
                  </div>
                  <span className="mb-2 text-[9px] font-semibold text-[#929c94]">Cycle {cycle.periodNumber}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid min-h-48 place-items-center text-center">
              <p className="max-w-xs text-xs leading-5 text-[#89948c]">Analytics will appear when contribution records are available for this chama.</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#929c94]">
            <span>Expected: {formatCurrency(expectedAmount)}</span>
            <span>Average recorded contribution: {formatCurrency(averagePaid)}</span>
          </div>
        </section>

        <section className="rounded-2xl border border-[#e9ece5] bg-white p-5 sm:p-6">
          <h2 className="display-font text-base font-extrabold text-[#24382b]">Operations snapshot</h2>
          <p className="mt-1 text-[10px] text-[#929c94]">Current payout-cycle and member activity</p>
          <div className="mt-5 divide-y divide-[#f0f2ed]">
            {[
              { label: 'Chama members', value: data.summary.memberCount, icon: Users },
              { label: 'Scheduled payout slots', value: data.slots.length, icon: CalendarDays },
              { label: 'Completed payout records', value: completedSlots, icon: ArrowDownLeft },
              { label: 'Active slot listings', value: listedSlots, icon: HandCoins },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-center gap-3 py-3">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#f4f7f2] text-[#65816b]"><Icon size={15} /></span>
                <span className="flex-1 text-[11px] text-[#718077]">{label}</span>
                <span className="text-sm font-bold text-[#344b39]">{value}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 rounded-xl bg-[#f7f8f4] px-3 py-2.5 text-[10px] leading-5 text-[#7d8980]">
            Figures describe application records only. Payout records do not confirm a provider transfer.
          </p>
        </section>
      </div>

      <section className="mt-5 overflow-hidden rounded-2xl border border-[#e9ece5] bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-[#eef0eb] px-5 py-4">
          <div>
            <h2 className="display-font text-sm font-extrabold text-[#24382b]">Member collection summary</h2>
            <p className="mt-1 text-[10px] text-[#929c94]">Current cycle · recorded ledger activity</p>
          </div>
          <button onClick={onContributions} className="flex items-center gap-1 text-[10px] font-bold text-[#4b825d]">View contributions <ArrowRight size={13} /></button>
        </div>
        {loading ? (
          <p className="p-8 text-center text-xs font-semibold text-[#819087]">Loading member activity…</p>
        ) : (
          <div className="divide-y divide-[#f0f2ed]">
            {data.members.map((member) => {
              const contribution = cycleContributions.find((item) => item.memberId === member.id);
              return (
                <div key={member.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#edf4ee] text-[9px] font-bold text-[#4e805e]">{initials(member.name)}</div>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#3a4b3f]">{member.name}</span>
                  <span className="hidden text-[10px] text-[#929c94] sm:inline">{contribution ? formatDate(contribution.dueDate) : 'No current record'}</span>
                  <span className="text-[10px] font-bold text-[#344b39]">{contribution ? formatCurrency(contribution.amount) : '—'}</span>
                  <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${contribution?.status === 'paid' ? 'bg-[#eaf3eb] text-[#43805a]' : contribution?.status === 'late' ? 'bg-[#fbefec] text-[#a65347]' : 'bg-[#f7f0e5] text-[#9a773d]'}`}>
                    {contribution?.status === 'paid' ? 'Recorded' : contribution?.status === 'late' ? 'Overdue' : contribution ? 'Pending' : 'No record'}
                  </span>
                </div>
              );
            })}
            {!data.members.length && <p className="p-8 text-center text-xs text-[#89948c]">No members in this chama yet.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function LandingPage({ onSignIn, onCreateAccount, onDemo, notice }) {
  return (
    <main className="page-transition min-h-screen overflow-hidden bg-[#f6f7f2]">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-5 sm:px-8">
        <Brand />
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button type="button" onClick={onSignIn} className="min-h-11 rounded-xl px-2 text-xs font-bold text-[#526c57] transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4b825d] sm:px-3">Sign in</button>
          <button type="button" onClick={onCreateAccount} className="min-h-11 rounded-xl bg-[#20543b] px-3 text-xs font-bold text-white shadow-sm transition hover:bg-[#173f2c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4b825d] sm:px-4">Get started</button>
        </div>
      </header>
      <section className="relative mx-auto grid max-w-7xl items-center gap-10 px-5 pb-16 pt-10 sm:px-8 md:grid-cols-[1.05fr_0.95fr] md:pb-24 md:pt-16">
        <div className="pointer-events-none absolute -right-32 -top-24 h-96 w-96 rounded-full bg-[#e6f0e5] blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#dce8dc] bg-white/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#4b825d]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#66a477]" /> A clearer way to save together
          </span>
          <h1 className="display-font mt-5 max-w-xl text-4xl font-extrabold leading-[1.08] tracking-[-0.065em] text-[#20362a] sm:text-5xl lg:text-6xl">
            Stronger chamas, built on <span className="text-[#4e8c61]">shared clarity.</span>
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-7 text-[#718077] sm:text-base">
            Organize contributions, follow payout schedules, and give every member a transparent view of their chama’s progress.
          </p>
          {notice && <p className="mt-4 rounded-xl border border-[#e4eadd] bg-white px-4 py-3 text-xs leading-5 text-[#55705e]">{notice}</p>}
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={onCreateAccount} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#20543b] px-5 text-xs font-bold text-white shadow-lg shadow-[#20543b]/15 transition hover:bg-[#173f2c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4b825d]">
              Create your account <ArrowRight size={15} />
            </button>
            <button type="button" onClick={onDemo} className="h-12 rounded-xl border border-[#dfe7dd] bg-white px-5 text-xs font-bold text-[#526c57] transition hover:bg-[#f9fbf7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4b825d]">
              Explore the demo
            </button>
          </div>
          <p className="mt-4 text-[10px] text-[#929c94]">Demo records are illustrative. Payment-provider transfers are not enabled.</p>
        </div>
        <div className="relative mx-auto w-full max-w-lg">
          <div className="rounded-[28px] border border-white bg-white/85 p-4 shadow-[0_24px_80px_rgba(31,64,43,0.12)] backdrop-blur sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold text-[#929c94]">CHAMA OVERVIEW</p>
                <p className="display-font mt-1 text-lg font-extrabold text-[#263b2e]">Mwangaza Chama</p>
              </div>
              <span className="rounded-full bg-[#edf4ee] px-2.5 py-1 text-[9px] font-bold text-[#4d795a]">Cycle 04</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-[#f5f8f3] p-4">
                <p className="text-[10px] text-[#89948c]">Contributions recorded</p>
                <p className="display-font mt-2 text-xl font-extrabold text-[#2c4c35]">KES 120,000</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e1e9df]"><div className="h-full w-3/4 rounded-full bg-[#5d9a6b]" /></div>
              </div>
              <div className="rounded-2xl bg-[#faf7ef] p-4">
                <p className="text-[10px] text-[#89948c]">Members contributing</p>
                <p className="display-font mt-2 text-xl font-extrabold text-[#735c35]">9 <span className="text-xs font-semibold">/ 12</span></p>
                <p className="mt-2 text-[9px] text-[#9a8d73]">Cycle progress at a glance</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-[#edf0e9] p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-[#405147]">Contribution trend</p>
                <BarChart3 size={15} className="text-[#5b8d67]" />
              </div>
              <div className="mt-4 flex h-20 items-end gap-2">
                {[42, 68, 54, 82, 72, 100, 88, 76, 95, 66, 84, 100].map((height, index) => (
                  <div key={index} className="flex h-full flex-1 items-end rounded-t bg-[#f1f5ef]">
                    <div className={`w-full rounded-t ${index === 11 ? 'bg-[#37764d]' : 'bg-[#8eb596]'}`} style={{ height: `${height}%` }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#eff5ef] px-3 py-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[#4b825d]"><ShieldCheck size={16} /></span>
              <div><p className="text-[10px] font-bold text-[#405147]">Clear records. Shared visibility.</p><p className="mt-0.5 text-[9px] text-[#819087]">One workspace for your chama’s activity.</p></div>
            </div>
          </div>
          <div className="absolute -bottom-5 -left-3 hidden items-center gap-2 rounded-xl border border-[#e9ece5] bg-white px-3 py-2.5 shadow-lg sm:flex">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#edf4ee] text-[#518062]"><Check size={14} /></span>
            <span className="text-[10px] font-bold text-[#405147]">A shared view of every cycle</span>
          </div>
        </div>
      </section>
      <section className="border-y border-[#e9ece5] bg-white/70">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:px-8 md:grid-cols-3">
          {[
            { title: 'Stay organized', text: 'Keep contribution schedules, member activity, and payout plans together.' },
            { title: 'See the full picture', text: 'Use clear operating summaries to understand progress and what needs attention.' },
            { title: 'Build with transparency', text: 'Make records visible to members and keep participation metrics understandable.' },
          ].map((item, index) => (
            <div key={item.title} className="flex gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#edf4ee] text-[#4e805e]">{index === 0 ? <Users size={17} /> : index === 1 ? <BarChart3 size={17} /> : <ShieldCheck size={17} />}</span>
              <div><h2 className="text-xs font-bold text-[#34483a]">{item.title}</h2><p className="mt-1 text-[11px] leading-5 text-[#89948c]">{item.text}</p></div>
            </div>
          ))}
        </div>
      </section>
      <footer className="mx-auto flex max-w-7xl flex-col justify-between gap-2 px-5 py-6 text-[10px] text-[#929c94] sm:flex-row sm:px-8">
        <span>ChamaFlow · Save together</span>
        <span>Payment-provider integrations are not enabled.</span>
      </footer>
    </main>
  );
}

function AuthScreen({ onAuthenticate, onDemo, onBack, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await onAuthenticate(mode, { fullName, email, password });
    } catch (error) {
      setFormError(error.message || 'Could not sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-transition grid min-h-screen place-items-center bg-[#f6f7f2] px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-[#e9ece5] bg-white p-6 shadow-sm sm:p-8">
        <Brand />
        <button type="button" onClick={onBack} className="mt-5 text-[10px] font-bold text-[#4b825d] hover:underline">← Back to home</button>
        <div className="mt-8">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#719079]">
            {mode === 'login' ? 'Welcome back' : 'Get started'}
          </p>
          <h1 className="display-font mt-2 text-2xl font-extrabold tracking-tight text-[#24382b]">
            {mode === 'login' ? 'Sign in to ChamaFlow' : 'Create your account'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#7c8980]">
            {mode === 'login'
              ? 'Continue managing your savings chamas.'
              : 'Join your community and start saving together.'}
          </p>
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === 'register' && (
            <label className="block text-xs font-semibold text-[#526258]">
              Full name
              <input
                required
                minLength={2}
                maxLength={100}
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-[#e4e9e1] px-3 text-sm font-normal text-[#34483a] outline-none focus:border-[#83a78a]"
              />
            </label>
          )}
          <label className="block text-xs font-semibold text-[#526258]">
            Email address
            <input
              required
              type="email"
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-[#e4e9e1] px-3 text-sm font-normal text-[#34483a] outline-none focus:border-[#83a78a]"
            />
          </label>
          <label className="block text-xs font-semibold text-[#526258]">
            Password
            <input
              required
              type="password"
              minLength={mode === 'register' ? 12 : undefined}
              maxLength={128}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-[#e4e9e1] px-3 text-sm font-normal text-[#34483a] outline-none focus:border-[#83a78a]"
            />
            {mode === 'register' && (
              <span className="mt-1 block text-[10px] font-normal text-[#89948c]">Use at least 12 characters.</span>
            )}
          </label>
          {formError && <p role="alert" className="rounded-xl bg-[#fbefec] px-3 py-2 text-xs text-[#a65347]">{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="h-11 w-full rounded-xl bg-[#20543b] text-xs font-bold text-white transition hover:bg-[#173f2c] disabled:cursor-wait disabled:opacity-70"
          >
            {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="mt-5 text-center text-xs text-[#7c8980]">
          {mode === 'login' ? 'New to ChamaFlow?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setFormError(''); }}
            className="font-bold text-[#357451] hover:underline"
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
        <div className="my-5 border-t border-[#edf0e9]" />
        <button
          type="button"
          onClick={onDemo}
          className="h-11 w-full rounded-xl border border-[#dfe7dd] text-xs font-bold text-[#526c57] transition hover:bg-[#f6f9f4]"
        >
          Continue with demo data
        </button>
        <p className="mt-3 text-center text-[10px] leading-5 text-[#929c94]">
          Demo data stays in this browser session and is not saved to PostgreSQL.
        </p>
      </section>
    </main>
  );
}

function App() {
  const [demoCache] = useState(() => createDemoData());
  const [contributions, setContributions] = useState(() => createDemoContributions(demoCache));
  const [contributionsLoading, setContributionsLoading] = useState(false);
  const [contributionsError, setContributionsError] = useState('');
  const [recordingId, setRecordingId] = useState(null);
  const [paymentContribution, setPaymentContribution] = useState(null);
  const [data, setData] = useState(demoCache);
  const [groups, setGroups] = useState([demoCache.group]);
  const [selectedGroupId, setSelectedGroupId] = useState(demoCache.group.id);
  const [offlineGroupData, setOfflineGroupData] = useState(() => new Map([[demoCache.group.id, demoCache]]));
  const [apiConnected, setApiConnected] = useState(false);
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem('chamaflowAccessToken'));
  const [authState, setAuthState] = useState('checking');
  const [authScreenOpen, setAuthScreenOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState('login');
  const [user, setUser] = useState(null);
  const [adminAccess, setAdminAccess] = useState({ platformAdmin: false, saccoAdmin: false, saccos: [] });
  const [adminRefreshKey, setAdminRefreshKey] = useState(0);
  const [landingNotice, setLandingNotice] = useState('');
  const [error, setError] = useState('');
  const [activePage, setActivePage] = useState('Overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupModalSaccoId, setGroupModalSaccoId] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [infoDialog, setInfoDialog] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [period, setPeriod] = useState('This month');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [liveRefreshError, setLiveRefreshError] = useState('');

  async function loadAccountData(token, signal) {
    const headers = { Authorization: `Bearer ${token}` };
    const adminResponse = await fetch(`${API_URL}/admin/access`, { headers, signal });
    const adminPayload = await adminResponse.json();
    if (!adminResponse.ok) throw new Error(adminPayload.error || 'Could not load administration permissions.');
    setAdminAccess(adminPayload);
    const response = await fetch(`${API_URL}/groups`, { headers, signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load savings groups.');
    const nextGroups = payload.groups || [];
    setGroups(nextGroups);
    setApiConnected(true);
    setOfflineGroupData(new Map());
    if (nextGroups.length === 0) {
      setData(null);
      setSelectedGroupId(null);
      if (adminPayload.platformAdmin || adminPayload.saccoAdmin) {
        navigateToPage('Administration');
      } else {
        setGroupModalOpen(true);
      }
      setError('');
      return;
    }

    const firstGroup = nextGroups[0];
    const dashboardResponse = await fetch(
      `${API_URL}/groups/${encodeURIComponent(firstGroup.id)}/dashboard`,
      { headers, signal },
    );
    const dashboard = await dashboardResponse.json();
    if (!dashboardResponse.ok) throw new Error(dashboard.error || 'Could not load the selected group.');
    setSelectedGroupId(firstGroup.id);
    setData(dashboard);
    if (adminPayload.platformAdmin || adminPayload.saccoAdmin) navigateToPage('Administration');
    setLastSyncedAt(new Date());
    setLiveRefreshError('');
    setError('');
  }

  useEffect(() => {
    const controller = new AbortController();
    async function restoreSession() {
      try {
        if (!accessToken) {
          const response = await fetch(`${API_URL}/health`, { signal: controller.signal });
          setApiConnected(response.ok);
          setAuthState(response.ok ? 'signedOut' : 'demo');
          return;
        }

        const response = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) {
          sessionStorage.removeItem('chamaflowAccessToken');
          setAccessToken(null);
          setUser(null);
          setAuthScreenOpen(false);
          setAuthState('signedOut');
          return;
        }
        setUser(payload.user);
        await loadAccountData(accessToken, controller.signal);
        setAuthState('authenticated');
      } catch (fetchError) {
        if (fetchError.name !== 'AbortError') {
          sessionStorage.removeItem('chamaflowAccessToken');
          setAccessToken(null);
          setUser(null);
          setApiConnected(false);
          setAuthState('demo');
        }
      }
    }
    restoreSession();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return undefined;

    function closeOnEscape(event) {
      if (event.key === 'Escape') setSidebarOpen(false);
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!data || !['Analytics', 'Contributions', 'Trust profile', 'My group'].includes(activePage)) return undefined;
    const demoMode = authState === 'demo' || typeof data.group.id === 'string';
    if (demoMode) {
      setContributions(createDemoContributions(data));
      setContributionsError('');
      setContributionsLoading(false);
      return undefined;
    }
    if (!accessToken || !apiConnected) {
      setContributions([]);
      setContributionsError('Contribution history is unavailable while the API is disconnected.');
      setContributionsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    async function loadContributions() {
      setContributionsLoading(true);
      setContributionsError('');
      try {
        const response = await fetch(
          `${API_URL}/groups/${encodeURIComponent(data.group.id)}/contributions`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
          },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not load contribution history.');
        setContributions(payload.contributions || []);
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setContributionsError(loadError.message || 'Could not load contribution history.');
        }
      } finally {
        if (!controller.signal.aborted) setContributionsLoading(false);
      }
    }
    loadContributions();
    return () => controller.abort();
  }, [activePage, selectedGroupId, accessToken, apiConnected, authState, data?.group?.id, data?.summary?.cycleNumber]);

  useEffect(() => {
    if (authState !== 'authenticated' || !accessToken || !data?.group?.id) return undefined;
    let timer;
    let stopped = false;
    const controller = new AbortController();

    async function refreshLiveData() {
      try {
        const headers = { Authorization: `Bearer ${accessToken}` };
        const dashboardResponse = await fetch(
          `${API_URL}/groups/${encodeURIComponent(data.group.id)}/dashboard`,
          { headers, signal: controller.signal },
        );
        const dashboard = await dashboardResponse.json();
        if (!dashboardResponse.ok) throw new Error(dashboard.error || 'Could not refresh chama data.');
        setData(dashboard);
        if (['Analytics', 'Contributions', 'Trust profile', 'My group'].includes(activePage)) {
          const contributionsResponse = await fetch(
            `${API_URL}/groups/${encodeURIComponent(data.group.id)}/contributions`,
            { headers, signal: controller.signal },
          );
          const contributionPayload = await contributionsResponse.json();
          if (!contributionsResponse.ok) {
            throw new Error(contributionPayload.error || 'Could not refresh contribution history.');
          }
          setContributions(contributionPayload.contributions || []);
          setContributionsError('');
        }
        setLastSyncedAt(new Date());
        setLiveRefreshError('');
      } catch (refreshError) {
        if (refreshError.name !== 'AbortError') {
          setLiveRefreshError(refreshError.message || 'Live data refresh failed.');
        }
      } finally {
        if (!stopped) timer = setTimeout(refreshLiveData, 15000);
      }
    }

    timer = setTimeout(refreshLiveData, 15000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [authState, accessToken, activePage, data?.group?.id]);

  const pageTitle = activePage === 'Overview' ? 'Overview' : activePage;
  const openInfo = (title, description) => {
    setNotificationsOpen(false);
    setInfoDialog({ title, description });
  };
  const navigateToPage = (page) => {
    if (page === activePage) return;
    const updatePage = () => flushSync(() => setActivePage(page));
    if (typeof document.startViewTransition === 'function') {
      document.startViewTransition(updatePage);
    } else {
      setActivePage(page);
    }
  };
  const selectPage = (page) => {
    navigateToPage(page);
    setSearchOpen(false);
  };
  const authenticate = async (mode, credentials) => {
    const response = await fetch(`${API_URL}/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not authenticate.');
    sessionStorage.setItem('chamaflowAccessToken', payload.token);
    setAccessToken(payload.token);
    setUser(payload.user);
    setPaymentContribution(null);
    try {
      await loadAccountData(payload.token);
    } catch (loadError) {
      sessionStorage.removeItem('chamaflowAccessToken');
      setAccessToken(null);
      setUser(null);
      setGroups([]);
      setData(null);
      throw loadError;
    }
    setAuthState('authenticated');
    setAuthScreenOpen(false);
  };
  const enterDemo = () => {
    setAccessToken(null);
    sessionStorage.removeItem('chamaflowAccessToken');
    setUser(null);
    setPaymentContribution(null);
    setAdminAccess({ platformAdmin: false, saccoAdmin: false, saccos: [] });
    setAuthState('demo');
    setData(demoCache);
    setGroups([demoCache.group]);
    setSelectedGroupId(demoCache.group.id);
    setOfflineGroupData(new Map([[demoCache.group.id, demoCache]]));
    setApiConnected(false);
    setLastSyncedAt(null);
    setLiveRefreshError('');
    setError('');
  };
  const signOut = async () => {
    let logoutNotice = '';
    try {
      if (accessToken) {
        const response = await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) throw new Error('The server could not revoke this session.');
      }
    } catch {
      logoutNotice = 'You have been signed out on this device. The server could not be reached to revoke the session; the token will expire automatically.';
    } finally {
      sessionStorage.removeItem('chamaflowAccessToken');
      setAccessToken(null);
      setUser(null);
      setPaymentContribution(null);
      setAdminAccess({ platformAdmin: false, saccoAdmin: false, saccos: [] });
      setGroups([]);
      setData(null);
      setAuthState('signedOut');
      setAuthScreenOpen(false);
      setLandingNotice(logoutNotice);
      setActivePage('Overview');
      setSearchTerm('');
      setSidebarOpen(false);
    }
  };
  const switchGroup = async (group) => {
    setPaymentContribution(null);
    setSelectedGroupId(group.id);
    const offlineData = offlineGroupData.get(group.id);
    if (offlineData) {
      setData(offlineData);
      setError('The API is offline. This chama is demo data and is not saved to PostgreSQL.');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/groups/${encodeURIComponent(group.id)}/dashboard`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load the selected group.');
      setData(payload);
      setLastSyncedAt(new Date());
      setLiveRefreshError('');
      setError('');
    } catch (fetchError) {
      setError(fetchError.message || 'Could not load the selected group.');
    }
  };
  const addGroupMember = async (memberDetails) => {
    if (!data?.group?.id) throw new Error('Select a savings group before adding a member.');
    const demoMode = authState === 'demo' || typeof data.group.id === 'string';
    if (demoMode) {
      const memberId = `demo-member-${Date.now()}`;
      const member = { id: memberId, ...memberDetails, role: 'Member', trustScore: 70, paid: false };
      const position = data.members.length + 1;
      const payoutDate = new Date(`${data.group.startDate}T12:00:00`);
      if (data.group.frequency === 'monthly') payoutDate.setMonth(payoutDate.getMonth() + position - 1);
      else payoutDate.setDate(payoutDate.getDate() + (position - 1) * (data.group.frequency === 'biweekly' ? 14 : 7));
      const nextData = {
        ...data,
        group: { ...data.group, memberCount: position },
        summary: {
          ...data.summary,
          memberCount: position,
          contributionProgress: position
            ? Math.round((data.summary.paidContributions / position) * 100)
            : 0,
        },
        members: [...data.members, member],
        slots: [...data.slots, {
          id: `${data.group.id}-slot-${position}`,
          position,
          amount: Number(data.group.contributionAmount) * position,
          payoutDate: payoutDate.toISOString().slice(0, 10),
          payoutDateLabel: new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' }).format(payoutDate),
          status: 'upcoming',
          isListed: false,
          memberName: member.name,
        }],
        activity: [
          { id: `demo-member-activity-${Date.now()}`, type: 'contribution', title: `${member.name} joined the circle`, amount: data.group.contributionAmount, timeLabel: 'Just now' },
          ...data.activity,
        ].slice(0, 10),
      };
      const nextContribution = {
        id: `demo-contribution-${Date.now()}`,
        memberId,
        memberName: member.name,
        periodNumber: data.summary.cycleNumber,
        amount: data.group.contributionAmount,
        dueDate: data.group.startDate,
        status: data.group.startDate < new Date().toISOString().slice(0, 10) ? 'late' : 'pending',
        paymentMethod: 'manual',
        paidAt: null,
      };
      setData(nextData);
      setOfflineGroupData((current) => new Map(current).set(data.group.id, nextData));
      setGroups((current) => current.map((group) => String(group.id) === String(data.group.id)
        ? { ...group, memberCount: position }
        : group));
      setContributions((current) => [...current, nextContribution]);
      return;
    }

    const response = await fetch(`${API_URL}/groups/${encodeURIComponent(data.group.id)}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(memberDetails),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not add this member.');
    const [dashboardResponse, contributionsResponse] = await Promise.all([
      fetch(`${API_URL}/groups/${encodeURIComponent(data.group.id)}/dashboard`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${API_URL}/groups/${encodeURIComponent(data.group.id)}/contributions`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    const [dashboard, contributionPayload] = await Promise.all([dashboardResponse.json(), contributionsResponse.json()]);
    if (!dashboardResponse.ok) throw new Error(dashboard.error || 'Member was added, but the group could not be refreshed.');
    if (!contributionsResponse.ok) throw new Error(contributionPayload.error || 'Member was added, but contributions could not be refreshed.');
    setData(dashboard);
    setContributions(contributionPayload.contributions || []);
    setGroups((current) => current.map((group) => String(group.id) === String(data.group.id)
      ? { ...group, memberCount: dashboard.summary.memberCount }
      : group));
  };
  const recordContribution = async (contribution) => {
    const demoMode = authState === 'demo' || typeof data?.group?.id === 'string';
    if (!demoMode) {
      const currentMember = data.members.find((member) => (
        member.email?.toLocaleLowerCase() === user?.email?.toLocaleLowerCase()
      ));
      if (currentMember && ['Administrator', 'Treasurer'].includes(currentMember.role)
        && currentMember.id !== contribution.memberId) {
        setRecordingId(contribution.id);
        setContributionsError('');
        try {
          const response = await fetch(
            `${API_URL}/groups/${encodeURIComponent(data.group.id)}/contributions/${encodeURIComponent(contribution.id)}/record-payment`,
            { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
          );
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || 'Could not record this contribution.');
          await refreshAfterPayment();
        } catch (requestError) {
          setContributionsError(requestError.message || 'Could not record this contribution.');
        } finally {
          setRecordingId(null);
        }
        return;
      }
      setPaymentContribution(contribution);
      return;
    }
    setRecordingId(contribution.id);
    setContributionsError('');
    try {
      if (demoMode) {
        const paidAt = new Date().toISOString();
        const updatedContributions = contributions.map((item) => item.id === contribution.id
          ? { ...item, status: 'paid', paymentMethod: 'simulated', paidAt }
          : item);
        setContributions(updatedContributions);
        setData((current) => {
          if (!current) return current;
          const members = current.members.map((member) => (
            member.id === contribution.memberId ? { ...member, paid: true } : member
          ));
          const paidContributions = updatedContributions.filter((item) => item.status === 'paid');
          return {
            ...current,
            members,
            summary: {
              ...current.summary,
              paidContributions: paidContributions.length,
              contributionProgress: current.summary.memberCount
                ? Math.round((paidContributions.length / current.summary.memberCount) * 100)
                : 0,
              totalContributions: paidContributions.reduce((total, item) => total + Number(item.amount), 0),
            },
            activity: [
              {
                id: `demo-payment-${Date.now()}`,
                type: 'contribution',
                title: `${contribution.memberName} recorded a simulated contribution`,
                amount: contribution.amount,
                timeLabel: 'Just now',
              },
              ...current.activity,
            ].slice(0, 10),
          };
        });
        return;
      }
    } finally {
      setRecordingId(null);
    }
  };
  const refreshAfterPayment = useCallback(async () => {
    if (!accessToken || !data?.group?.id) return;
    const headers = { Authorization: `Bearer ${accessToken}` };
    try {
      const [contributionsResponse, dashboardResponse] = await Promise.all([
        fetch(`${API_URL}/groups/${encodeURIComponent(data.group.id)}/contributions`, { headers }),
        fetch(`${API_URL}/groups/${encodeURIComponent(data.group.id)}/dashboard`, { headers }),
      ]);
      const [contributionsPayload, dashboard] = await Promise.all([
        contributionsResponse.json(),
        dashboardResponse.json(),
      ]);
      if (!contributionsResponse.ok) throw new Error(contributionsPayload.error || 'Could not refresh contribution history.');
      if (!dashboardResponse.ok) throw new Error(dashboard.error || 'Could not refresh the chama summary.');
      setContributions(contributionsPayload.contributions || []);
      setData(dashboard);
      setContributionsError('');
    } catch (refreshError) {
      setContributionsError(refreshError.message || 'Payment was confirmed, but the workspace could not refresh.');
    }
  }, [accessToken, data?.group?.id]);

  const createGroup = async (formData) => {
    if (!apiConnected) {
      const groupId = `demo-${Date.now()}`;
      const demoGroup = createDemoData({
        groupId,
        groupName: formData.name,
        contributionAmount: formData.contributionAmount,
        frequency: formData.frequency,
        startDate: formData.startDate,
        memberNames: formData.members,
      });
      setOfflineGroupData((current) => new Map(current).set(groupId, demoGroup));
      setGroups((current) => [demoGroup.group, ...current]);
      setSelectedGroupId(groupId);
      setData(demoGroup);
      setError('The API is offline. This chama is demo data and is not saved to PostgreSQL.');
      return demoGroup.group;
    }

    const response = await fetch(`${API_URL}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(formData),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not create the savings group.');

    const dashboardResponse = await fetch(`${API_URL}/groups/${encodeURIComponent(payload.group.id)}/dashboard`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const dashboard = await dashboardResponse.json();
    if (!dashboardResponse.ok) throw new Error(dashboard.error || 'Group was created, but its dashboard could not be loaded.');

    setGroups((current) => [payload.group, ...current]);
    setSelectedGroupId(payload.group.id);
    setData(dashboard);
    setAdminRefreshKey((current) => current + 1);
    setError('');
    return payload.group;
  };

  if (authState === 'checking') {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f6f7f2]">
        <p className="text-xs font-semibold text-[#819087]">Checking your session…</p>
      </div>
    );
  }
  if (authState === 'signedOut') {
    return authScreenOpen
      ? <AuthScreen
          onAuthenticate={authenticate}
          onDemo={enterDemo}
          onBack={() => setAuthScreenOpen(false)}
          initialMode={authInitialMode}
        />
      : (
        <LandingPage
          onSignIn={() => { setAuthInitialMode('login'); setAuthScreenOpen(true); }}
          onCreateAccount={() => { setAuthInitialMode('register'); setAuthScreenOpen(true); }}
          onDemo={enterDemo}
          notice={landingNotice}
        />
      );
  }

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar
        activePage={activePage}
        setActivePage={selectPage}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onManageGroups={() => setGroupModalOpen(true)}
        group={groups.find((group) => String(group.id) === String(selectedGroupId)) || data?.group}
        groupCount={groups.length}
        adminAccess={adminAccess}
        userName={user?.fullName || 'Demo guest'}
        userEmail={user?.email}
        onAccountSettings={() => selectPage('Settings')}
      />
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[#e9ece5] bg-[#f6f7f2]/95 px-4 backdrop-blur sm:px-7 lg:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Open navigation"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-[#e4e9e1] bg-white text-[#5e6d62] lg:hidden"
            >
              <Menu size={17} />
            </button>
            <p className="truncate text-xs font-semibold text-[#718077]">Workspace <span className="mx-1.5 text-[#c0c7c0]">/</span> {pageTitle}</p>
          </div>
          <div className="relative flex items-center gap-2 sm:gap-3">
            <label className="hidden items-center gap-2 rounded-xl border border-[#e5e9e1] bg-white px-3 py-2 transition focus-within:border-[#9eb9a2] md:flex">
              <Search size={14} className="text-[#98a198]" />
              <input
                aria-label="Search members and payout slots"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  if (event.target.value && ['Overview', 'Slot marketplace'].includes(activePage)) navigateToPage('Slot marketplace');
                }}
                placeholder="Search"
                className="w-28 bg-transparent text-[11px] text-[#526258] outline-none placeholder:text-[#a0a9a1] lg:w-36"
              />
              <kbd className="rounded border border-[#e9ece5] px-1 text-[9px] text-[#9ca59d]">/</kbd>
            </label>
            <button
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-[#e5e9e1] bg-white text-[#738076] transition hover:bg-[#f4f7f2] md:hidden"
            >
              <Search size={16} />
            </button>
            {searchOpen && (
              <div className="absolute inset-x-0 top-0 z-30 flex h-10 items-center gap-2 rounded-xl border border-[#dce5dc] bg-white px-3 shadow-lg md:hidden">
                <Search size={14} className="shrink-0 text-[#98a198]" />
                <input
                  aria-label="Search members and payout slots"
                  autoFocus
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    if (event.target.value && ['Overview', 'Slot marketplace'].includes(activePage)) navigateToPage('Slot marketplace');
                  }}
                  placeholder="Search members"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                />
                <button
                  aria-label="Close search"
                  onClick={() => {
                    setSearchOpen(false);
                    setSearchTerm('');
                  }}
                  className="grid h-7 w-7 place-items-center text-[#738076]"
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="relative">
              <button
                aria-label="Notifications"
                aria-expanded={notificationsOpen}
                onClick={() => setNotificationsOpen((open) => !open)}
                className="relative grid h-9 w-9 place-items-center rounded-xl border border-[#e5e9e1] bg-white text-[#738076] transition hover:bg-[#f4f7f2]"
              >
                <Bell size={16} />
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#db8b5b]" />
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 top-12 z-30 w-[min(290px,calc(100vw-2rem))] rounded-2xl border border-[#e9ece5] bg-white p-4 shadow-xl">
                  <p className="text-xs font-bold text-[#34483a]">You’re all caught up</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#87928a]">New contributions and payout updates from your chama will appear here.</p>
                  <button onClick={() => setNotificationsOpen(false)} className="mt-3 text-[11px] font-bold text-[#4b825d]">Close</button>
                </div>
              )}
            </div>
            {authState === 'authenticated' || authState === 'demo' ? (
              <>
                <span className="hidden max-w-36 truncate text-[11px] font-semibold text-[#526258] sm:block">{user?.fullName || 'Demo guest'}</span>
                <button onClick={signOut} aria-label={authState === 'demo' ? 'Exit demo' : 'Sign out'} title={authState === 'demo' ? 'Exit demo' : 'Sign out'} className="grid h-9 w-9 place-items-center rounded-xl border border-[#e5e9e1] bg-white text-[#738076] transition hover:bg-[#f4f7f2]">
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <button onClick={() => { setAuthInitialMode('login'); setAuthScreenOpen(true); setAuthState('signedOut'); }} className="rounded-xl border border-[#dfe7dd] bg-white px-3 py-2 text-[10px] font-bold text-[#526c57]">
                Home / Sign in
              </button>
            )}
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8 lg:px-9">
          {activePage === 'Settings' ? (
            <div className="page-transition">
              <AccountSettingsPage
                user={user}
                accessToken={accessToken}
                demoMode={authState !== 'authenticated'}
                onUserUpdated={setUser}
                onSignOut={signOut}
              />
            </div>
          ) : activePage === 'Administration' && authState === 'authenticated' && (adminAccess.platformAdmin || adminAccess.saccoAdmin) ? (
            <div className="page-transition">
              <AdminWorkspace
                accessToken={accessToken}
                adminAccess={adminAccess}
                refreshKey={adminRefreshKey}
                onCreateGroup={(saccoId) => {
                  setGroupModalSaccoId(saccoId);
                  setGroupModalOpen(true);
                }}
              />
            </div>
          ) : !data && authState === 'authenticated' && groups.length === 0 ? (
            <div className="grid min-h-[50vh] place-items-center">
              <div className="max-w-sm text-center">
                <h1 className="display-font text-xl font-extrabold text-[#24382b]">Create your first savings chama</h1>
                <p className="mt-2 text-sm leading-6 text-[#7c8980]">Set up a chama to invite members and plan your contribution schedule.</p>
                <button onClick={() => setGroupModalOpen(true)} className="mt-5 h-11 rounded-xl bg-[#20543b] px-5 text-xs font-bold text-white">
                  Create a chama
                </button>
              </div>
            </div>
          ) : !data ? (
            <div className="grid min-h-[50vh] place-items-center">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#dce8dd] border-t-[#427452]" />
                <p className="mt-3 text-xs font-semibold text-[#819087]">Loading your chama…</p>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-5 flex items-start gap-2 rounded-xl border border-[#e4eadd] bg-[#f1f7f1] px-4 py-3 text-xs leading-5 text-[#55705e]">
                  <Sparkles size={15} className="mt-0.5 shrink-0" />
                  {apiConnected
                    ? error
                    : 'Showing sample data because the API is offline. Start the backend to use database data.'}
                </div>
              )}
              <div key={activePage} className="page-transition" style={{ viewTransitionName: 'app-page' }}>
                {activePage === 'Overview' ? (
                  <Dashboard
                    data={data}
                    userName={user?.fullName || (authState === 'demo' ? 'Demo guest' : '')}
                    onMarketplace={() => navigateToPage('Slot marketplace')}
                    onGroup={() => navigateToPage('My group')}
                    onActivity={() => openInfo('Recent activity', data.activity.map((item) => `${item.timeLabel} — ${item.title}${item.amount ? ` (${formatCurrency(item.amount)})` : ''}`).join('\n'))}
                    period={period}
                    setPeriod={setPeriod}
                  />
                ) : activePage === 'Analytics' ? (
                  <AnalyticsPage
                    data={data}
                    contributions={contributions}
                    loading={contributionsLoading}
                    error={contributionsError}
                    demoMode={authState === 'demo' || typeof data.group.id === 'string'}
                    onContributions={() => navigateToPage('Contributions')}
                  />
                ) : activePage === 'Slot marketplace' ? (
                  <Marketplace data={data} onOpenRequest={setSelectedSlot} searchTerm={searchTerm} />
                ) : activePage === 'Contributions' ? (
                  <ContributionsPage
                    data={data}
                    contributions={contributions}
                    loading={contributionsLoading}
                    error={contributionsError}
                    demoMode={authState === 'demo' || typeof data.group.id === 'string'}
                    userEmail={user?.email}
                    recordingId={recordingId}
                    onRecord={recordContribution}
                    searchTerm={searchTerm}
                  />
                ) : activePage === 'Trust profile' ? (
                  <TrustProfilePage
                    data={data}
                    contributions={contributions}
                    loading={contributionsLoading}
                    error={contributionsError}
                    demoMode={authState === 'demo' || typeof data.group.id === 'string'}
                    searchTerm={searchTerm}
                  />
                ) : activePage === 'My group' ? (
                  <GroupPage data={data} contributions={contributions} searchTerm={searchTerm} userEmail={user?.email} onAddMember={addGroupMember} />
                ) : (
                  <GroupPage data={data} contributions={contributions} searchTerm={searchTerm} />
                )}
              </div>
            </>
          )}
          <footer className="mt-9 flex flex-col justify-between gap-2 border-t border-[#e9ece5] pt-4 text-[10px] text-[#9aa39c] sm:flex-row">
            <p>
              ChamaFlow · {authState === 'authenticated' ? 'Database-backed workspace' : 'Demo workspace'}
            </p>
            <p>
              {authState === 'authenticated'
                ? liveRefreshError
                  ? `Live refresh paused: ${liveRefreshError}`
                  : `Auto-refresh every 15 seconds · ${lastSyncedAt ? `Last updated ${formatDate(lastSyncedAt.toISOString(), true)}` : 'Waiting for first refresh'}`
                : 'Demonstration workspace · Sample records · Payment and investment integrations not enabled'}
            </p>
          </footer>
        </div>
      </main>
      {paymentContribution && authState === 'authenticated' && accessToken && data?.group?.id && (
        <PaymentModal
          groupId={data.group.id}
          contribution={paymentContribution}
          accessToken={accessToken}
          onClose={() => setPaymentContribution(null)}
          onConfirmed={refreshAfterPayment}
        />
      )}
      <RequestModal slot={selectedSlot} onClose={() => setSelectedSlot(null)} />
      <InfoModal dialog={infoDialog} onClose={() => setInfoDialog(null)} />
      {groupModalOpen && (
        <GroupManagerModal
          groups={groups}
          selectedGroupId={selectedGroupId}
          defaultSaccoId={groupModalSaccoId}
          onClose={() => { if (groups.length > 0 || authState === 'demo') setGroupModalOpen(false); }}
          onSelect={switchGroup}
          onCreate={createGroup}
        />
      )}
    </div>
  );
}

export default App;
