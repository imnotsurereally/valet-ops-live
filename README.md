# Valet Ops Live

Internal web app for Optima Dealer Services – live valet dispatch + key tracking system.

## Architecture

- **Frontend**: Static HTML/JS (deployed via GitHub Pages)
- **Backend**: Supabase (PostgreSQL + Realtime subscriptions)
- **Version**: V0.912

## Pages & Screens

### Service Operations

- **`index.html`** – Home/router page (owner/manager only)
- **`dispatcher.html`** – Main dispatcher screen with full control, metrics, and timers
- **`keymachine.html`** – Key machine station + valet handoff tracking
- **`carwash.html`** – Car wash area status tracking
- **`wallboard.html`** – TV wallboard display (read-only view)
- **`serviceadvisor.html`** – Service advisor request creation
- **`loancar.html`** – Loan car customer arrival tracking
- **`history.html`** – Historical ticket lookup (dispatcher access)

### Sales Operations

- **`sales_manager.html`** – Sales manager request creation and monitoring
- **`sales_driver.html`** – Sales driver pickup execution

### Authentication

- **`login.html`** – User authentication portal

## Features

### Core Functionality

- **Real-time Updates**: Supabase Realtime subscriptions for live data sync
- **Role-Based Access Control**: Multi-level permissions (owner, manager, employees)
- **Ticket Management**: Create, track, and complete valet pickup tickets
- **Status Tracking**: 
  - Pickup statuses (NEW, STAGED, KEYS_IN_MACHINE, KEYS_WITH_VALET, WAITING_FOR_CUSTOMER, COMPLETE)
  - Wash statuses (IN_WASH_AREA, ON_RED_LINE, REWASH, NEEDS_REWASH, DUSTY)
- **Timer System**: 
  - Master cycle timer (active pickup duration)
  - Valet timer (keys with valet duration)
  - Color-coded severity (green/yellow/orange/red)
- **Notes System**: Append-only notes with timestamps
- **Audit Logging**: All actions logged to `pickup_events` and `sales_pickup_events` tables

### Dispatcher Features

- **Metrics Dashboard**: 
  - Completed tickets today
  - Average cycle time
  - Active/waiting counts
  - Redline count
  - Valet workload distribution
- **PQI Toggle**: Performance Quality Indicator display
- **Sound Alerts**: Audio notifications for timer thresholds
- **Completed Section**: Collapsible completed tickets view

### Sales Features

- **Request Management**: Create and track sales pickup requests
- **Driver Assignment**: Assign drivers to requests
- **Status Workflow**: REQUESTED → ON_THE_WAY → COMPLETE/CANCELLED
- **Cancel Reasons**: Track cancellation reasons (SWITCHED_STOCK, WRONG_STOCK, AT_MARRIOTT, AT_ARMSTRONG, OTHER)

### Operations Reliability

- **Debug Strip**: Toggle with Ctrl+Shift+D (shows store, role, realtime status, last refresh, last write)
- **Global Banner**: Error/warning/success notifications
- **No-op Detection**: Alerts when updates affect 0 rows (RLS/store context issues)
- **Connection Status**: Real-time connection monitoring

## User Roles

### Owner/Manager
- Full access to all pages
- Home router access
- Can view and manage all operations

### Employees (Role-Based Routing)
- **Dispatcher**: Access to dispatcher.html + history.html
- **Key Machine**: Access to keymachine.html only
- **Car Wash**: Access to carwash.html only
- **Wallboard**: Read-only access to wallboard.html
- **Service Advisor**: Access to serviceadvisor.html (notes only, no status changes)
- **Loan Car**: Access to loancar.html (notes only, no status changes)
- **Sales Manager**: Access to sales_manager.html
- **Sales Driver**: Access to sales_driver.html

## Technical Details

### Key Files

- **`app.js`** – Main service operations logic (V0.912)
- **`auth.js`** – Authentication and role-based routing
- **`supabaseClient.js`** – Supabase client configuration
- **`history.js`** – Historical ticket lookup
- **`sales.js`** – Sales operations module
- **`style.css`** – Global stylesheet
- **`debugHarness.js`** – Debug utilities (enabled with `?debug=1`)

### Database Tables

- **`pickups`** – Service pickup tickets
- **`sales_pickups`** – Sales pickup requests
- **`pickup_events`** – Service audit log
- **`sales_pickup_events`** – Sales audit log
- **`profiles`** – User profiles with roles
- **`store_settings`** – Store configuration (salespeople, drivers)

### Timer Thresholds

- **Green**: < 10 minutes
- **Yellow**: 10-19 minutes
- **Orange**: 20-24 minutes
- **Red**: ≥ 25 minutes

### State Management

- **LocalStorage**: UI state (completed collapse, PQI toggle, debug visibility)
- **Supabase Realtime**: Live data synchronization
- **Store Isolation**: All queries filtered by `store_id` via RLS

## Development

### Dependencies

- Supabase JS v1.35.7 (via CDN)

### Browser Support

- Modern browsers with ES6 module support
- Requires JavaScript enabled

### Deployment

- Static files served via GitHub Pages
- No build step required
- Supabase backend handles all server-side logic
