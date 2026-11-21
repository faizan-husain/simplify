import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import { AmountInput } from '../components/ui/AmountInput';
import { Select } from '../components/ui/Select';
import { Combobox } from '../components/ui/Combobox';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/Tabs';
import { FilterChip } from '../components/ui/FilterChip';
import { StatusDot } from '../components/ui/StatusDot';
import { Badge } from '../components/ui/Badge';
import { ListRow } from '../components/ui/ListRow';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Dialog } from '../components/ui/Dialog';
import { Sheet } from '../components/ui/Sheet';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Avatar } from '../components/ui/Avatar';
import { Kbd } from '../components/ui/Kbd';
import { QuietChart } from '../components/ui/QuietChart';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Plus,
  Trash2,
  Search,
  Bell,
  Settings,
  MoreVertical,
  ArrowUpRight,
} from 'lucide-react';


export function KitPage() {
  const { showToast } = useToast();

  // Component test states
  const [inputValue, setInputValue] = useState('');
  const [amountValue, setAmountValue] = useState('1250');
  const [selectValue, setSelectValue] = useState('option-1');
  const [comboboxValue, setComboboxValue] = useState<string | null>('1');
  const [segmentedValue, setSegmentedValue] = useState('Month');
  const [activeTab, setActiveTab] = useState('overview');
  const [activeChip, setActiveChip] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const chartSampleData = [
    { label: '18 Oct', income: 4200, outgoing: 1200 },
    { label: '20 Oct', income: 6800, outgoing: 2400 },
    { label: '22 Oct', income: 5100, outgoing: 3100 },
    { label: '24 Oct', income: 8900, outgoing: 2800 },
    { label: '26 Oct', income: 7400, outgoing: 3900 },
    { label: '28 Oct', income: 11200, outgoing: 4100 },
    { label: '30 Oct', income: 13500, outgoing: 5200 },
  ];

  const comboboxItems = [
    { id: '1', label: 'Rahul Sharma', sublabel: '+91 98765 43210' },
    { id: '2', label: 'Pooja Verma', sublabel: '+91 98111 22334' },
    { id: '3', label: 'Ankit Patel', sublabel: '+91 99000 11223' },
    { id: '4', label: 'Global Tech Solutions', sublabel: 'GST Exempt' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-divider pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-semibold text-accent tracking-wider uppercase">Design System</span>
            <Badge variant="accent">Quiet Luxury</Badge>
          </div>
          <h1 className="text-[28px] font-semibold text-text tracking-tight">Component Kit Showcase</h1>
          <p className="text-[14px] text-text-muted mt-0.5">
            Internal reference for all tokens, primitives, and component states.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Kbd>⌘K</Kbd>
          <span className="text-[13px] text-text-muted">Global Search</span>
        </div>
      </div>

      {/* 1. Tokens: Colors & Surfaces */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-text">1. Palette & Surface Tokens</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
          <div className="p-3 rounded-control border border-hair bg-white shadow-card">
            <div className="w-full h-8 rounded-small bg-[#111827] mb-2" />
            <div className="text-[12.5px] font-semibold text-text">--ink</div>
            <div className="text-[11px] text-text-muted font-mono">#111827</div>
          </div>
          <div className="p-3 rounded-control border border-hair bg-white shadow-card">
            <div className="w-full h-8 rounded-small bg-[#0F766E] mb-2" />
            <div className="text-[12.5px] font-semibold text-text">--accent</div>
            <div className="text-[11px] text-text-muted font-mono">#0F766E (Teal)</div>
          </div>
          <div className="p-3 rounded-control border border-hair bg-white shadow-card">
            <div className="w-full h-8 rounded-small bg-[#EEF4F3] border border-accent/20 mb-2" />
            <div className="text-[12.5px] font-semibold text-text">--accent-soft</div>
            <div className="text-[11px] text-text-muted font-mono">#EEF4F3</div>
          </div>
          <div className="p-3 rounded-control border border-hair bg-white shadow-card">
            <div className="w-full h-8 rounded-small bg-[#15803D] mb-2" />
            <div className="text-[12.5px] font-semibold text-text">--success</div>
            <div className="text-[11px] text-text-muted font-mono">#15803D</div>
          </div>
          <div className="p-3 rounded-control border border-hair bg-white shadow-card">
            <div className="w-full h-8 rounded-small bg-[#B45309] mb-2" />
            <div className="text-[12.5px] font-semibold text-text">--warning</div>
            <div className="text-[11px] text-text-muted font-mono">#B45309</div>
          </div>
          <div className="p-3 rounded-control border border-hair bg-white shadow-card">
            <div className="w-full h-8 rounded-small bg-[#B91C1C] mb-2" />
            <div className="text-[12.5px] font-semibold text-text">--danger</div>
            <div className="text-[11px] text-text-muted font-mono">#B91C1C</div>
          </div>
        </div>
      </section>

      {/* 2. StatCards */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-text">2. KPI StatCards (§4)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Income"
            value={45820}
            delta={{ value: '+14.2%', isPositive: true, label: 'vs last month' }}
            icon={<TrendingUp className="w-4 h-4 text-accent" />}
            sparklineData={[30, 45, 40, 60, 55, 75, 90]}
          />
          <StatCard
            label="Outgoing"
            value={14200}
            delta={{ value: '-3.5%', isPositive: false, label: 'vs last month' }}
            icon={<TrendingDown className="w-4 h-4 text-text-muted" />}
            sparklineData={[80, 70, 75, 60, 50, 45, 40]}
          />
          <StatCard
            label="Net Profit"
            value={31620}
            delta={{ value: '+22.8%', isPositive: true, label: 'profit margin' }}
            icon={<ArrowUpRight className="w-4 h-4 text-accent" />}
            sparklineData={[20, 35, 45, 50, 65, 80, 95]}
          />
          <StatCard
            label="Outstanding Dues"
            value={8450}
            delta={{ value: '4 overdue', isPositive: false, label: 'invoices' }}
            icon={<Clock className="w-4 h-4 text-warning" />}
            sparklineData={[40, 50, 45, 60, 55, 65, 70]}
          />
        </div>
      </section>

      {/* 3. Buttons & Actions */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-text">3. Buttons & IconButtons</h2>
        <Card className="space-y-6">
          <div>
            <div className="text-[13px] font-medium text-text-muted mb-3">Button Variants</div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">
                <Plus className="w-4 h-4 mr-1.5" />
                Primary CTA (Ink)
              </Button>
              <Button variant="secondary">Secondary Chip</Button>
              <Button variant="ghost">Ghost Button</Button>
              <Button variant="destructive">
                <Trash2 className="w-4 h-4 mr-1.5" />
                Destructive
              </Button>
              <Button variant="primary" loading>
                Saving Bill
              </Button>
              <Button variant="secondary" disabled>
                Disabled
              </Button>
            </div>
          </div>

          <div className="border-t border-divider pt-4">
            <div className="text-[13px] font-medium text-text-muted mb-3">IconButtons (Aria-label mandatory)</div>
            <div className="flex items-center gap-3">
              <IconButton aria-label="Notifications">
                <Bell className="w-4 h-4" />
              </IconButton>
              <IconButton aria-label="Settings">
                <Settings className="w-4 h-4" />
              </IconButton>
              <IconButton aria-label="Search">
                <Search className="w-4 h-4" />
              </IconButton>
              <IconButton aria-label="More actions" size="sm">
                <MoreVertical className="w-4 h-4" />
              </IconButton>
              <IconButton aria-label="Delete" size="sm">
                <Trash2 className="w-4 h-4 text-danger" />
              </IconButton>
            </div>
          </div>
        </Card>

      </section>

      {/* 4. Form Controls */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-text">4. Inputs, Amount & Combobox</h2>
        <Card className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Input
            label="Customer Name"
            placeholder="e.g. Ramesh Kumar"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            hint="Full name as per official ID"
          />

          <AmountInput
            label="Bill Amount"
            value={amountValue}
            onChange={(val) => setAmountValue(val)}
            hint="Tabular numbers with ₹ prefix"
          />

          <Select
            label="Payment Mode"
            value={selectValue}
            onChange={(val) => setSelectValue(val)}
            options={[
              { value: 'option-1', label: 'UPI / QR Code' },
              { value: 'option-2', label: 'Cash Payment' },
              { value: 'option-3', label: 'Bank Transfer (NEFT/IMPS)' },
              { value: 'option-4', label: 'Cheque' },
            ]}
          />

          <Combobox
            label="Search Customer"
            items={comboboxItems}
            selectedId={comboboxValue}
            onSelect={(item) => setComboboxValue(item.id)}
            placeholder="Type customer name or mobile..."
            onAddNew={(text) => alert(`Create new: ${text}`)}
            recentItems={comboboxItems.slice(0, 2)}
          />

          <Input
            label="Invalid Field (Error State)"
            defaultValue="invalid@test"
            error="Please enter a valid 10-digit mobile number"
          />

          <AmountInput
            label="Unpaid Balance (Disabled)"
            value="0.00"
            onChange={() => {}}
            disabled
          />
        </Card>
      </section>

      {/* 5. Navigation & Filters */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-text">5. SegmentedControl, Tabs & FilterChips</h2>
        <Card className="space-y-6">
          <div>
            <div className="text-[13px] font-medium text-text-muted mb-2">Segmented Control</div>
            <SegmentedControl
              value={segmentedValue}
              onChange={setSegmentedValue}
              options={[
                { value: 'Today', label: 'Today' },
                { value: 'Week', label: 'This Week' },
                { value: 'Month', label: 'This Month' },
                { value: 'FY', label: 'FY 2026-27' },
              ]}
            />
          </div>

          <div className="border-t border-divider pt-4">
            <div className="text-[13px] font-medium text-text-muted mb-2">Text Tabs with Underline & Badges</div>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="overview" count={12}>
                  Active Invoices
                </TabsTrigger>
                <TabsTrigger value="unpaid" count={3}>
                  Unpaid
                </TabsTrigger>
                <TabsTrigger value="completed">
                  Completed
                </TabsTrigger>
                <TabsTrigger value="history">
                  Audit History
                </TabsTrigger>
              </TabsList>
              <TabsContent value="overview">
                <div className="p-3 text-[13.5px] text-text-muted">Showing 12 active invoices...</div>
              </TabsContent>
              <TabsContent value="unpaid">
                <div className="p-3 text-[13.5px] text-text-muted">Showing 3 unpaid invoices...</div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="border-t border-divider pt-4">
            <div className="text-[13px] font-medium text-text-muted mb-2">Filter Chips</div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                label="Status: Unpaid"
                active={activeChip}
                onClick={() => setActiveChip(!activeChip)}
                onRemove={() => setActiveChip(false)}
              />
              <FilterChip label="Mode: UPI" onRemove={() => {}} />
              <FilterChip label="FY: 2026-27" onRemove={() => {}} />
              <FilterChip label="+ Add Filter" onClick={() => {}} />
            </div>
          </div>
        </Card>
      </section>

      {/* 6. Status Indicators & Badges */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-text">6. StatusDot (8px Dot + 14/400 Text) & Badges</h2>
        <Card className="flex flex-wrap items-center gap-6">
          <StatusDot status="paid" />
          <StatusDot status="partial" />
          <StatusDot status="due" />
          <StatusDot status="overdue" />
          <StatusDot status="cancelled" />
          <div className="h-5 w-[1px] bg-divider" />
          <Badge>4 Bills</Badge>
          <Badge variant="accent">3 Due Jobs</Badge>
          <Avatar name="Rahul Sharma" size="md" />
          <Avatar name="Simplify Admin" size="sm" />
        </Card>
      </section>

      {/* 7. List Rows & Progress Bar */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-text">7. ListRow (52px, Radius 12) & ProgressBar</h2>
        <Card className="p-2 space-y-1">
          <ListRow
            title="Passport Application — Tatkaal"
            subtitle="Applicant: Rohit Verma • Bill #INV-1042"
            leftContent={<StatusDot status="partial" label="" />}
            rightContent={
              <div className="text-right">
                <div className="text-[14px] font-semibold text-text tabular-nums">₹1,500</div>
                <div className="text-[12px] text-text-muted">Due 3 Nov</div>
              </div>
            }
            onClick={() => {}}
            showChevron
          />
          <ListRow
            title="PAN Card Correction"
            subtitle="Applicant: Sangeeta Devi • Bill #INV-1041"
            leftContent={<StatusDot status="paid" label="" />}
            rightContent={
              <div className="text-right">
                <div className="text-[14px] font-semibold text-text tabular-nums">₹250</div>
                <div className="text-[12px] text-success">Completed</div>
              </div>
            }
            onClick={() => {}}
            showChevron
          />
          <div className="p-3 border-t border-divider mt-2 space-y-2">
            <div className="flex justify-between text-[12.5px] text-text-muted">
              <span>Overall Job Completion</span>
              <span className="font-semibold text-text">75%</span>
            </div>
            <ProgressBar value={75} />
          </div>
        </Card>
      </section>

      {/* 8. QuietChart */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-text">8. QuietChart (Income vs Outgoing)</h2>
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[15px] font-semibold text-text">Revenue & Expense Trend</h3>
              <p className="text-[13px] text-text-muted">Smooth SVG curves with ink tooltip on hover</p>
            </div>
          </div>
          <QuietChart data={chartSampleData} height={240} />
        </Card>
      </section>

      {/* 9. Feedback & Modals */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-text">9. Dialog, Sheet, ConfirmDialog & Toast</h2>
        <Card className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open Dialog (520px)
          </Button>
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>
            Open Drawer / Sheet
          </Button>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            Open Confirm Dialog
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              showToast('Bill #INV-1043 saved successfully', 'success', {
                label: 'View Bill',
                onClick: () => alert('Viewing bill...'),
              })
            }
          >
            Show Success Toast
          </Button>
          <Button
            variant="ghost"
            onClick={() => showToast('Failed to record receipt: Network timeout', 'error')}
          >
            Show Error Toast
          </Button>
        </Card>

        {/* Dialog Example */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="Quick Bill Settings" description="Configure receipt header and numbering preferences">
          <div className="space-y-4 py-2">
            <Input label="Invoice Prefix" defaultValue="INV-" />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>Save Settings</Button>
            </div>
          </div>
        </Dialog>

        {/* Sheet Example */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Bill #INV-1042 Details" description="Issued on 28 Oct 2026">
          <div className="space-y-4 py-2">
            <div className="p-3 bg-surface-2 rounded-control space-y-1">
              <div className="text-[12px] text-text-muted">Customer</div>
              <div className="text-[14px] font-semibold text-text">Rohit Verma</div>
              <div className="text-[13px] text-text-muted">+91 98765 43210</div>
            </div>
            <div className="flex justify-between py-2 border-b border-divider">
              <span className="text-[13.5px] text-text-muted">Total Amount</span>
              <span className="text-[14px] font-semibold text-text">₹1,500</span>
            </div>
            <div className="flex justify-between py-2 border-b border-divider">
              <span className="text-[13.5px] text-text-muted">Paid</span>
              <span className="text-[14px] font-semibold text-success">₹1,000</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-[13.5px] text-text-muted">Balance Due</span>
              <span className="text-[14px] font-semibold text-danger">₹500</span>
            </div>
            <Button variant="primary" className="w-full mt-4" onClick={() => setSheetOpen(false)}>
              Receive Payment
            </Button>
          </div>
        </Sheet>

        {/* ConfirmDialog Example */}
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete Customer?"
          description="Are you sure you want to delete this customer? This action can be undone from Recently Deleted."
          confirmLabel="Delete Customer"
          onConfirm={() => {
            setConfirmOpen(false);
            showToast('Customer moved to Recently Deleted', 'info');
          }}
        />
      </section>

      {/* 10. EmptyState & Skeletons */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-text">10. EmptyState & Skeletons</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <EmptyState
              title="No bills created yet"
              description="Start by creating your first bill. It takes less than 10 seconds."
              actionLabel="Create First Bill"
              onAction={() => alert('New Bill')}
            />
          </Card>
          <Card className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </Card>
        </div>
      </section>
    </div>
  );
}
