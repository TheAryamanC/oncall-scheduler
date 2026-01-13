// Main scheduler instance - exposed on window for cross-script access
window.scheduler = new OnCallScheduler();
const scheduler = window.scheduler;

// FullCalendar instance for the calendar view
let calendar = null;

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initializeTabs();
    initializeDateDefaults();
    initializeShiftCounts();
    loadSetup();
    updateManualEmailDropdown();
    updateSessionBarState();
});

// Initialize tab navigation
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === tabId) {
                    content.classList.add('active');
                }
            });

            if (tabId === 'calendar' && scheduler.schedule.length > 0) {
                initializeCalendar();
            }
            if (tabId === 'schedule') {
                updateSchedulePreview();
            }
            if (tabId === 'collect') {
                updatePreferenceSummary();
                updateManualEmailDropdown();
            }
        });
    });
}

// Initialize shift count inputs
function initializeShiftCounts() {
    const primaryInput = document.getElementById('primaryCount');
    const secondaryInput = document.getElementById('secondaryCount');

    primaryInput.addEventListener('change', updateShiftCounts);
    secondaryInput.addEventListener('change', updateShiftCounts);
}

// Update shift counts in scheduler
function updateShiftCounts() {
    const primaryParsed = parseInt(document.getElementById('primaryCount').value);
    const secondaryParsed = parseInt(document.getElementById('secondaryCount').value);
    const primaryCount = isNaN(primaryParsed) ? 1 : primaryParsed;
    const secondaryCount = isNaN(secondaryParsed) ? 1 : secondaryParsed;
    scheduler.setShiftCounts(primaryCount, secondaryCount);
    saveSetup();
}

// Initialize date inputs with defaults - next month
function initializeDateDefaults() {
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');

    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const endOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0);

    startInput.value = formatDateForInput(nextMonth);
    endInput.value = formatDateForInput(endOfNextMonth);

    startInput.addEventListener('change', updateDateRange);
    endInput.addEventListener('change', updateDateRange);
    
    updateDateRange();
}

// Update date range in scheduler
function updateDateRange() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (startDate && endDate) {
        scheduler.setDateRange(startDate, endDate);
        updateFormLink();
        saveSetup();
    }
}

// Format date as YYYY-MM-DD for input fields
function formatDateForInput(date) {
    return date.toISOString().split('T')[0];
}

// Add a new person to the scheduler
function addPerson() {
    const nameInput = document.getElementById('personName');
    const emailInput = document.getElementById('personEmail');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();

    if (!name || !email) {
        alert('Please enter both name and email');
        return;
    }

    try {
        scheduler.addPerson(name, email);
        renderPeopleList();
        nameInput.value = '';
        emailInput.value = '';
        nameInput.focus();
        saveSetup();
        updateFormLink();
    } catch (e) {
        alert(e.message);
    }
}

// Remove a person from the scheduler
function removePerson(email) {
    if (confirm('Are you sure you want to remove this person?')) {
        scheduler.removePerson(email);
        renderPeopleList();
        saveSetup();
        updateFormLink();
    }
}

// Render the list of people in the UI
function renderPeopleList() {
    const container = document.getElementById('peopleList');
    
    if (scheduler.people.length === 0) {
        container.innerHTML = '<p class="muted">No team members added yet.</p>';
        return;
    }

    container.innerHTML = scheduler.people.map(person => {
        const prefs = scheduler.preferences.get(person.email);
        const hasPrefs = prefs && (prefs.preferred.size > 0 || prefs.notPreferred.size > 0);
        
        return `
            <div class="person-item">
                <div class="person-info">
                    <span class="person-name">${escapeHtml(person.name)}</span>
                    <span class="person-email">${escapeHtml(person.email)}</span>
                    <span class="person-status ${hasPrefs ? 'status-submitted' : 'status-pending'}">
                        ${hasPrefs ? 'Preferences submitted' : 'Awaiting preferences'}
                    </span>
                </div>
                <button class="btn btn-danger btn-small" onclick="removePerson('${escapeHtml(person.email)}')">
                    Remove
                </button>
            </div>
        `;
    }).join('');

    updatePersonFilter();
}

// Save current setup to localStorage - in case browser restarts
function saveSetup() {
    const primaryParsed = parseInt(document.getElementById('primaryCount').value);
    const secondaryParsed = parseInt(document.getElementById('secondaryCount').value);
    const data = {
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
        primaryCount: isNaN(primaryParsed) ? 1 : primaryParsed,
        secondaryCount: isNaN(secondaryParsed) ? 1 : secondaryParsed,
        people: scheduler.people,
        preferences: Array.from(scheduler.preferences.entries()).map(([email, prefs]) => ({
            email,
            preferred: Array.from(prefs.preferred),
            notPreferred: Array.from(prefs.notPreferred)
        })),
        schedule: scheduler.schedule
    };
    localStorage.setItem('oncall-scheduler-data', JSON.stringify(data));
}

// Load setup from localStorage
function loadSetup() {
    const saved = localStorage.getItem('oncall-scheduler-data');
    if (!saved) return;

    try {
        const data = JSON.parse(saved);
        
        if (data.startDate) {
            document.getElementById('startDate').value = data.startDate;
        }
        if (data.endDate) {
            document.getElementById('endDate').value = data.endDate;
        }
        updateDateRange();

        if (data.primaryCount !== undefined && data.primaryCount !== null) {
            document.getElementById('primaryCount').value = data.primaryCount;
        }
        if (data.secondaryCount !== undefined && data.secondaryCount !== null) {
            document.getElementById('secondaryCount').value = data.secondaryCount;
        }
        updateShiftCounts();

        scheduler.people = data.people || [];
        
        // Initialize empty preferences for all loaded people first
        for (const person of scheduler.people) {
            scheduler.preferences.set(person.email, {
                preferred: new Set(),
                notPreferred: new Set()
            });
        }
        
        // Then load any saved preferences on top
        if (data.preferences) {
            for (const pref of data.preferences) {
                scheduler.preferences.set(pref.email, {
                    preferred: new Set(pref.preferred),
                    notPreferred: new Set(pref.notPreferred)
                });
            }
        }

        if (data.schedule && data.schedule.length > 0) {
            scheduler.schedule = data.schedule.map(s => ({
                ...s,
                date: new Date(s.date || s.dateStr)
            }));
        }

        renderPeopleList();
    } catch (e) {
        console.error('Failed to load saved data:', e);
    }
}

// Import preferences from CSV file
function importPreferencesCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const csv = e.target.result;
            const lines = csv.split('\n').map(line => parseCSVLine(line));
            
            if (lines.length < 2) {
                alert('CSV file appears to be empty');
                return;
            }

            const headers = lines[0].map(h => h.toLowerCase().trim());
            const emailCol = headers.findIndex(h => h.includes('email'));
            const preferredCol = headers.findIndex(h => h.includes('prefer'));
            const unavailableCol = headers.findIndex(h => h.includes('unavail') || h.includes('not') || h.includes('cannot'));

            if (emailCol === -1) {
                alert('Could not find Email column in CSV. Expected column with "email" in the header.');
                return;
            }

            let imported = 0;
            let errors = [];

            for (let i = 1; i < lines.length; i++) {
                const row = lines[i];
                if (!row || row.length === 0) continue;

                const email = (row[emailCol] || '').trim().toLowerCase();
                if (!email) continue;

                if (!scheduler.preferences.has(email)) {
                    errors.push(`Row ${i + 1}: Unknown email "${email}"`);
                    continue;
                }

                const preferred = preferredCol >= 0 ? parseDateList(row[preferredCol]) : [];
                const unavailable = unavailableCol >= 0 ? parseDateList(row[unavailableCol]) : [];

                scheduler.setPreferences(email, preferred, unavailable);
                imported++;
            }

            renderPeopleList();
            updatePreferenceSummary();
            saveSetup();

            if (errors.length > 0) {
                alert(`Imported ${imported} preferences.\n\nWarnings:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}`);
            } else {
                alert(`Successfully imported ${imported} preferences!`);
            }

        } catch (err) {
            alert('Failed to import CSV: ' + err.message);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// Parse a single CSV line into fields
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

// Parse a list of dates from a string
function parseDateList(str) {
    if (!str) return [];
    
    return str
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(s => s)
        .map(s => {
            const date = new Date(s);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                return s;
            }
            return null;
        })
        .filter(s => s);
}

// Update the manual email dropdown with current people
function updateManualEmailDropdown() {
    const select = document.getElementById('manualEmail');
    if (!select) return;
    
    const currentValue = select.value;
    select.innerHTML = '<option value="">-- Select person --</option>';
    
    for (const person of scheduler.people) {
        const option = document.createElement('option');
        option.value = person.email;
        option.textContent = `${person.name} (${person.email})`;
        select.appendChild(option);
    }
    
    select.value = currentValue;
}

// Save manual preferences from the form
function saveManualPreferences() {
    const email = document.getElementById('manualEmail').value;
    const preferredStr = document.getElementById('manualPreferred').value;
    const unavailableStr = document.getElementById('manualUnavailable').value;

    if (!email) {
        alert('Please select a person');
        return;
    }

    const preferred = parseDateList(preferredStr);
    const unavailable = parseDateList(unavailableStr);

    scheduler.setPreferences(email, preferred, unavailable);
    
    renderPeopleList();
    updatePreferenceSummary();
    saveSetup();

    document.getElementById('manualPreferred').value = '';
    document.getElementById('manualUnavailable').value = '';
    
    alert(`Preferences saved for ${email}!\nPreferred: ${preferred.length} dates\nUnavailable: ${unavailable.length} dates`);
}

// Update the schedule preview statistics
function updateSchedulePreview() {
    const container = document.getElementById('schedulePreview');
    const dates = scheduler.generateDates();
    const weekendDays = dates.filter(d => scheduler.isWeekendNight(d)).length;
    const weekdayDays = dates.length - weekendDays;

    const primaryCount = scheduler.primaryCount;
    const secondaryCount = scheduler.secondaryCount;
    const totalSlotsPerDay = primaryCount + secondaryCount;

    const prefsSubmitted = scheduler.people.filter(p => {
        const prefs = scheduler.preferences.get(p.email);
        return prefs && (prefs.preferred.size > 0 || prefs.notPreferred.size > 0);
    }).length;

    container.innerHTML = `
        <div class="preview-stat">
            <span>Date Range:</span>
            <strong>${document.getElementById('startDate').value} to ${document.getElementById('endDate').value}</strong>
        </div>
        <div class="preview-stat">
            <span>Total Days:</span>
            <strong>${dates.length}</strong>
        </div>
        <div class="preview-stat">
            <span>Weekday Nights:</span>
            <strong>${weekdayDays} (12-hour primary shifts)</strong>
        </div>
        <div class="preview-stat">
            <span>Weekend Nights:</span>
            <strong>${weekendDays} (24-hour primary shifts)</strong>
        </div>
        <div class="preview-stat">
            <span>Shifts per Day:</span>
            <strong>${primaryCount} primary + ${secondaryCount} secondary = ${totalSlotsPerDay} total</strong>
        </div>
        <div class="preview-stat">
            <span>Total Shift Slots:</span>
            <strong>${dates.length * totalSlotsPerDay} (${dates.length * primaryCount} primary + ${dates.length * secondaryCount} secondary)</strong>
        </div>
        <div class="preview-stat">
            <span>Team Members:</span>
            <strong>${scheduler.people.length}</strong>
        </div>
        <div class="preview-stat">
            <span>Minimum Required:</span>
            <strong>${totalSlotsPerDay} people</strong>
        </div>
        <div class="preview-stat">
            <span>Preferences Submitted:</span>
            <strong>${prefsSubmitted} / ${scheduler.people.length}</strong>
        </div>
    `;
}

// Generate the schedule
function generateSchedule() {
    const resultsContainer = document.getElementById('scheduleResults');
    const fairnessContainer = document.getElementById('fairnessReport');

    const totalSlotsPerDay = scheduler.primaryCount + scheduler.secondaryCount;

    try {
        if (scheduler.people.length < totalSlotsPerDay) {
            throw new Error(`You need at least ${totalSlotsPerDay} team members to schedule (${scheduler.primaryCount} primary + ${scheduler.secondaryCount} secondary per day)`);
        }

        resultsContainer.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        
        setTimeout(() => {
            try {
                const result = scheduler.generateSchedule();
                
                resultsContainer.innerHTML = `
                    <div class="result-success">
                        <strong>Schedule generated successfully!</strong>
                        <p>Scheduled ${result.schedule.length} shifts for ${scheduler.people.length} people.</p>
                        <p>Fairness Score: <strong>${result.fairnessReport.fairnessScore}/100</strong></p>
                        <p>Go to the <strong>View Calendar</strong> tab to see the schedule.</p>
                    </div>
                `;

                renderFairnessReport(result.fairnessReport);
                
                saveSetup();

            } catch (e) {
                resultsContainer.innerHTML = `
                    <div class="result-error">
                        <strong>Failed to generate schedule</strong>
                        <p>${escapeHtml(e.message)}</p>
                    </div>
                `;
            }
        }, 100);

    } catch (e) {
        resultsContainer.innerHTML = `
            <div class="result-error">
                <strong>Cannot generate schedule</strong>
                <p>${escapeHtml(e.message)}</p>
            </div>
        `;
    }
}

// Render the fairness report
function renderFairnessReport(report) {
    const container = document.getElementById('fairnessReport');
    
    let tableRows = report.byPerson.map(p => `
        <tr>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td class="${getFairnessClass(p.weekdayPrimary, report.averageLoad.weekday_primary)}">${p.weekdayPrimary}</td>
            <td class="${getFairnessClass(p.weekendPrimary, report.averageLoad.weekend_primary)}">${p.weekendPrimary}</td>
            <td class="${getFairnessClass(p.weekdaySecondary, report.averageLoad.weekday_secondary)}">${p.weekdaySecondary}</td>
            <td class="${getFairnessClass(p.weekendSecondary, report.averageLoad.weekend_secondary)}">${p.weekendSecondary}</td>
            <td>${p.totalShifts}</td>
            <td>${p.totalHours}h</td>
            <td>${p.preferredAssignments}</td>
            <td>${p.notPreferredAssignments > 0 ? `<span style="color: red">${p.notPreferredAssignments}</span>` : '0'}</td>
        </tr>
    `).join('');

    tableRows += `
        <tr style="background: #e2e8f0; font-weight: 600;">
            <td>Average</td>
            <td>${report.averageLoad.weekday_primary.toFixed(1)}</td>
            <td>${report.averageLoad.weekend_primary.toFixed(1)}</td>
            <td>${report.averageLoad.weekday_secondary.toFixed(1)}</td>
            <td>${report.averageLoad.weekend_secondary.toFixed(1)}</td>
            <td colspan="4">-</td>
        </tr>
    `;

    container.innerHTML = `
        <div style="margin-bottom: 1rem;">
            <strong>Fairness Score: ${report.fairnessScore}/100</strong>
            ${report.fairnessScore >= 80 ? 'Excellent balance' : 
              report.fairnessScore >= 60 ? 'Good balance' : 
              'Significant imbalance'}
        </div>
        <table class="fairness-table">
            <thead>
                <tr>
                    <th>Person</th>
                    <th>Weekday<br>Primary</th>
                    <th>Weekend<br>Primary</th>
                    <th>Weekday<br>Secondary</th>
                    <th>Weekend<br>Secondary</th>
                    <th>Total<br>Shifts</th>
                    <th>Total<br>Hours</th>
                    <th>Preferred<br>Days</th>
                    <th>Unavail.<br>Days</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
    `;
}

// Get CSS class for fairness coloring
function getFairnessClass(value, average) {
    const diff = Math.abs(value - average);
    if (diff <= 1) return 'fairness-good';
    if (diff <= 2) return 'fairness-warning';
    return '';
}

// Initialize the calendar with scheduled events
function initializeCalendar() {
    const container = document.getElementById('calendarContainer');
    
    if (calendar) {
        calendar.destroy();
    }

    updateCalendarLegend();

    const events = scheduler.getCalendarEvents();
    
    calendar = new FullCalendar.Calendar(container, {
        initialView: 'dayGridMonth',
        initialDate: scheduler.dateRange.start || new Date(),
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,dayGridWeek,listMonth'
        },
        events: events,
        eventClick: function(info) {
            const props = info.event.extendedProps;
            const person = props.person;
            alert(`
Shift Details:
━━━━━━━━━━━━━━━
Date: ${info.event.startStr}
Role: ${props.role.charAt(0).toUpperCase() + props.role.slice(1)} ${props.slot.toUpperCase()}
Duration: ${props.duration} hours
Weekend: ${props.isWeekend ? 'Yes (24h primary)' : 'No'}
Assigned to: ${person ? person.name : 'Unassigned'}
Email: ${person ? person.email : 'N/A'}
            `.trim());
        },
        eventDidMount: function(info) {
            if (info.event.extendedProps.isWeekend) {
                info.el.classList.add('weekend-shift');
            }
        }
    });

    calendar.render();
    updatePersonFilter();
}

// Update the calendar
function updateCalendarLegend() {
    const legendContainer = document.getElementById('calendarLegend');
    if (!legendContainer) return;

    let legendHtml = '';
    
    for (let i = 0; i < scheduler.primaryCount; i++) {
        const label = String.fromCharCode(65 + i); // A, B, C, D...
        const color = scheduler.primaryColors[i % scheduler.primaryColors.length];
        legendHtml += `<span class="legend-item"><span class="color-box" style="background: ${color};"></span> Primary ${label}</span>`;
    }
    
    for (let i = 0; i < scheduler.secondaryCount; i++) {
        const label = String.fromCharCode(65 + i);
        const color = scheduler.secondaryColors[i % scheduler.secondaryColors.length];
        legendHtml += `<span class="legend-item"><span class="color-box" style="background: ${color};"></span> Secondary ${label}</span>`;
    }
    
    legendHtml += `<span class="legend-item"><span class="color-box" style="background: linear-gradient(135deg, #1e40af 50%, #fbbf24 50%);"></span> Weekend (24h primary)</span>`;
    
    legendContainer.innerHTML = legendHtml;
}

// Update person filter dropdown
function updatePersonFilter() {
    const select = document.getElementById('filterPerson');
    const currentValue = select.value;
    
    select.innerHTML = '<option value="">All People</option>';
    
    for (const person of scheduler.people) {
        const option = document.createElement('option');
        option.value = person.email;
        option.textContent = person.name;
        select.appendChild(option);
    }
    
    select.value = currentValue;
}

// Filter calendar events based on selected person and role
function filterCalendar() {
    if (!calendar) return;

    const filterPerson = document.getElementById('filterPerson').value;
    const filterRole = document.getElementById('filterRole').value;

    const events = scheduler.getCalendarEvents(
        filterPerson || null,
        filterRole || null
    );

    calendar.removeAllEvents();
    calendar.addEventSource(events);
}

// Export schedule to CSV file
function exportScheduleCSV() {
    if (scheduler.schedule.length === 0) {
        alert('No schedule to export. Generate a schedule first.');
        return;
    }
    downloadFile('oncall-schedule.csv', scheduler.exportToCSV(), 'text/csv');
}

// Utility function to escape HTML
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Utility function to download a file
function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Handle Enter key for adding person
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        if (e.target.id === 'personName' || e.target.id === 'personEmail') {
            addPerson();
        }
    }
});

// Update session bar state
function updateSessionBarState() {
    const sessionBar = document.getElementById('sessionBar');
    if (sessionBar) {
        sessionBar.classList.remove('active');
    }
}

// Update form link with session ID
function updateFormLink() {
    if (typeof sessionManager !== 'undefined' && sessionManager.sessionId) {
        updateEmailLinks();
    }
}

// Update preference summary display
function updatePreferenceSummary() {
    const container = document.getElementById('preferenceSummary');
    if (!container) return;
    
    const people = scheduler.people;
    const summaryLines = people.map(person => {
        const prefs = scheduler.preferences.get(person.email);
        if (!prefs || (prefs.preferred.size === 0 && prefs.notPreferred.size === 0)) {
            return `<div class="pref-item pending"><span class="name">${escapeHtml(person.name)}</span><span class="status">No preferences</span></div>`;
        }
        return `<div class="pref-item submitted"><span class="name">${escapeHtml(person.name)}</span><span class="status">${prefs.preferred.size} preferred, ${prefs.notPreferred.size} unavailable</span></div>`;
    });
    
    if (summaryLines.length === 0) {
        container.innerHTML = '<p class="muted">Add RAs in the Setup tab first.</p>';
    } else {
        container.innerHTML = `<div class="pref-summary-list">${summaryLines.join('')}</div>`;
    }
}

// Extend OnCallScheduler with additional methods if needed
if (typeof OnCallScheduler !== 'undefined') {
    OnCallScheduler.prototype.setPersonPreferences = function(email, preferred, unavailable) {
        this.setPreferences(email, preferred, unavailable);
    };
    
    OnCallScheduler.prototype.getPeople = function() {
        return this.people;
    };
}