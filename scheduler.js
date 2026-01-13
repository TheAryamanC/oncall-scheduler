// Class to generate schedules
class OnCallScheduler {
    constructor() {
        this.people = [];
        this.dateRange = { start: null, end: null };
        this.preferences = new Map();
        this.schedule = [];
        this.primaryCount = 1;
        this.secondaryCount = 1;
        this.primaryColors = [
            '#1e40af', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
            '#c084fc', '#d8b4fe', '#7c3aed', '#4f46e5', '#4338ca'
        ];
        this.secondaryColors = [
            '#166534', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
            '#0891b2', '#0e7490', '#155e75', '#059669', '#047857'
        ];
    }

    // Set number of primary and secondary shifts per night
    setShiftCounts(primaryCount, secondaryCount) {
        this.primaryCount = Math.max(0, Math.min(10, primaryCount));
        this.secondaryCount = Math.max(0, Math.min(10, secondaryCount));
    }

    // Add an RA to the scheduler
    addPerson(name, email) {
        if (this.people.find(p => p.email === email)) {
            throw new Error(`Person with email ${email} already exists`);
        }
        this.people.push({ name, email, id: this.generateId() });
        
        // Initialize empty preferences for this RA
        this.preferences.set(email, {
            preferred: new Set(),
            notPreferred: new Set()
        });
    }

    // Remove an RA from the scheduler
    removePerson(email) {
        this.people = this.people.filter(p => p.email !== email);
        this.preferences.delete(email);
    }

    // Parse a date string as local time (not UTC)
    // This fixes timezone issues where "2025-01-03" would be parsed as UTC midnight
    parseLocalDate(dateStr) {
        if (dateStr instanceof Date) {
            return new Date(dateStr);
        }
        // Parse YYYY-MM-DD as local time by splitting and using Date constructor
        const parts = String(dateStr).split('-');
        if (parts.length === 3) {
            return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        }
        // Fallback: create date and normalize to local midnight
        const d = new Date(dateStr);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // Set the date range
    setDateRange(startDate, endDate) {
        this.dateRange.start = this.parseLocalDate(startDate);
        this.dateRange.end = this.parseLocalDate(endDate);
        // Normalize to midnight
        this.dateRange.start.setHours(0, 0, 0, 0);
        this.dateRange.end.setHours(0, 0, 0, 0);
    }

    // Set preferences for an RA
    setPreferences(email, preferred, notPreferred) {
        if (!this.preferences.has(email)) {
            throw new Error(`Person with email ${email} not found`);
        }
        this.preferences.set(email, {
            preferred: new Set(preferred.map(d => this.normalizeDate(d))),
            notPreferred: new Set(notPreferred.map(d => this.normalizeDate(d)))
        });
    }

    // Generate all dates in the date range
    generateDates() {
        const dates = [];
        const current = new Date(this.dateRange.start);
        while (current <= this.dateRange.end) {
            dates.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }
        return dates;
    }

    // Check if a date is a weekend night (Friday or Saturday)
    isWeekendNight(date) {
        const day = date.getDay();
        return day === 5 || day === 6; // Friday = 5, Saturday = 6
    }

    // Get day name from date
    getDayName(date) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }

    // Get slot label (a, b, c, ...) based on index
    getSlotLabel(index) {
        return String.fromCharCode(97 + index); // 97 = 'a'
    }

    // Simple string hash function for deterministic rotation
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    // Generate all slots to be filled
    generateSlots() {
        const dates = this.generateDates();
        const slots = [];

        for (const date of dates) {
            const isWeekend = this.isWeekendNight(date);
            const dateStr = this.normalizeDate(date);

            // Create primary shift slots
            for (let i = 0; i < this.primaryCount; i++) {
                const slotLabel = this.getSlotLabel(i);
                slots.push({
                    id: `${dateStr}-primary-${slotLabel}`,
                    date: new Date(date),
                    dateStr,
                    role: 'primary',
                    slot: slotLabel,
                    slotIndex: i,
                    isWeekend,
                    duration: isWeekend ? 24 : 12, // Weekend primary = 24h
                    assignedPerson: null
                });
            }

            // Create secondary shift slots (always 12 hours)
            for (let i = 0; i < this.secondaryCount; i++) {
                const slotLabel = this.getSlotLabel(i);
                slots.push({
                    id: `${dateStr}-secondary-${slotLabel}`,
                    date: new Date(date),
                    dateStr,
                    role: 'secondary',
                    slot: slotLabel,
                    slotIndex: i,
                    isWeekend,
                    duration: 12,
                    assignedPerson: null
                });
            }
        }

        return slots;
    }

    // Check if an RA can be assigned to a slot based on preferences
    canAssign(person, slot) {
        const prefs = this.preferences.get(person.email);
        if (prefs && prefs.notPreferred.has(slot.dateStr)) {
            return false;
        }
        return true;
    }

    // Calculate cost for assigning a person to a slot - lower is better
    calculateCost(person, slot, currentLoad, targets) {
        let cost = 0;
        const prefs = this.preferences.get(person.email);
        const load = currentLoad.get(person.email);
        const shiftType = this.getShiftTypeKey(slot);
        const personCount = load[shiftType];
        const target = targets ? targets[shiftType] : null;
        
        // FAIRNESS IS THE PRIMARY FACTOR
        // The cost is primarily based on how many shifts this person already has
        // in this category - people with fewer shifts get MUCH lower costs
        
        if (target) {
            // Very heavy penalty if at or above max (effectively blocks them)
            if (personCount >= target.max) {
                cost += 100000;
            } else {
                // Primary cost = current count * 1000
                // This means someone with 0 shifts has cost 0, 
                // someone with 1 shift has cost 1000, etc.
                // This DOMINATES all other factors
                cost += personCount * 1000;
                
                // Additional penalty if at or above minimum (others should catch up)
                if (personCount >= target.min && target.min > 0) {
                    cost += 500;
                }
            }
        }
        
        // Secondary factor: preference (much smaller impact than fairness)
        // Only matters when comparing people with same shift count
        if (prefs && prefs.preferred.has(slot.dateStr)) {
            cost -= 5;
        } else if (prefs && prefs.notPreferred.has(slot.dateStr)) {
            cost += 10;
        }
        
        // Small base cost for weekend shifts (tie-breaker)
        if (slot.isWeekend) {
            cost += 2;
        }

        // Huge penalty for same-day double assignment
        const sameDayShifts = this.getSameDayShifts(person, slot);
        if (sameDayShifts.length > 0) {
            cost += 1000000;
        }

        return cost;
    }

    // Get key for shift type in load tracking
    getShiftTypeKey(slot) {
        const weekend = slot.isWeekend ? 'weekend' : 'weekday';
        return `${weekend}_${slot.role}`;
    }

    // Initialize load tracking map
    initializeLoad() {
        const load = new Map();
        for (const person of this.people) {
            load.set(person.email, {
                weekday_primary: 0,
                weekend_primary: 0,
                weekday_secondary: 0,
                weekend_secondary: 0,
                total_hours: 0
            });
        }
        return load;
    }

    // Calculate average load across all RAs
    calculateAverageLoad(currentLoad) {
        const sum = {
            weekday_primary: 0,
            weekend_primary: 0,
            weekday_secondary: 0,
            weekend_secondary: 0
        };
        
        for (const load of currentLoad.values()) {
            sum.weekday_primary += load.weekday_primary;
            sum.weekend_primary += load.weekend_primary;
            sum.weekday_secondary += load.weekday_secondary;
            sum.weekend_secondary += load.weekend_secondary;
        }

        const n = this.people.length;
        return {
            weekday_primary: sum.weekday_primary / n,
            weekend_primary: sum.weekend_primary / n,
            weekday_secondary: sum.weekday_secondary / n,
            weekend_secondary: sum.weekend_secondary / n
        };
    }

    // Get shifts assigned to a person on the same day as a slot
    getSameDayShifts(person, slot) {
        return this.schedule.filter(s => 
            s.assignedPerson && 
            s.assignedPerson.email === person.email && 
            s.dateStr === slot.dateStr
        );
    }

    // Calculate target shifts per person for each category
    calculateTargetShifts() {
        const dates = this.generateDates();
        const weekdayCount = dates.filter(d => !this.isWeekendNight(d)).length;
        const weekendCount = dates.filter(d => this.isWeekendNight(d)).length;
        const n = this.people.length;
        
        return {
            weekday_primary: {
                total: weekdayCount * this.primaryCount,
                min: Math.floor((weekdayCount * this.primaryCount) / n),
                max: Math.ceil((weekdayCount * this.primaryCount) / n)
            },
            weekend_primary: {
                total: weekendCount * this.primaryCount,
                min: Math.floor((weekendCount * this.primaryCount) / n),
                max: Math.ceil((weekendCount * this.primaryCount) / n)
            },
            weekday_secondary: {
                total: weekdayCount * this.secondaryCount,
                min: Math.floor((weekdayCount * this.secondaryCount) / n),
                max: Math.ceil((weekdayCount * this.secondaryCount) / n)
            },
            weekend_secondary: {
                total: weekendCount * this.secondaryCount,
                min: Math.floor((weekendCount * this.secondaryCount) / n),
                max: Math.ceil((weekendCount * this.secondaryCount) / n)
            }
        };
    }

    // Main scheduling function
    generateSchedule() {
        const totalSlotsPerDay = this.primaryCount + this.secondaryCount;
        
        // Validate we have enough RAs
        if (this.people.length < totalSlotsPerDay) {
            throw new Error(
                `Need at least ${totalSlotsPerDay} people to schedule ` +
                `(${this.primaryCount} primary + ${this.secondaryCount} secondary per day)`
            );
        }

        if (!this.dateRange.start || !this.dateRange.end) {
            throw new Error('Date range not set');
        }

        // Generate all slots that need to be filled
        const slots = this.generateSlots();
        
        // Initialize load tracking
        const currentLoad = this.initializeLoad();
        
        // Calculate target shifts for fairness enforcement
        const targets = this.calculateTargetShifts();
        
        // Clear previous schedule
        this.schedule = [];

        // Sort slots: prioritize harder-to-fill slots first
        // Weekend and primary slots are typically harder to fill
        slots.sort((a, b) => {
            if (a.dateStr !== b.dateStr) {
                return a.date - b.date;
            }
            const diffA = (a.isWeekend ? 10 : 0) + (a.role === 'primary' ? 5 : 0);
            const diffB = (b.isWeekend ? 10 : 0) + (b.role === 'primary' ? 5 : 0);
            return diffB - diffA;
        });

        // Assign each slot
        for (const slot of slots) {
            const shiftTypeKey = this.getShiftTypeKey(slot);
            const target = targets[shiftTypeKey];
            
            // Build candidate list: Start with people who prefer or are neutral
            // Build candidate list with STRICT FAIRNESS enforcement
            // Everyone below their minimum target MUST be included regardless of preferences
            let candidates = this.people.filter(p => {
                const load = currentLoad.get(p.email);
                
                // Skip if already at max for this shift type
                if (load[shiftTypeKey] >= target.max) return false;
                
                // Skip if already has a shift on this day
                const sameDayShifts = this.getSameDayShifts(p, slot);
                if (sameDayShifts.length > 0) return false;
                
                // ALWAYS include if below minimum (regardless of preferences)
                if (load[shiftTypeKey] < target.min) return true;
                
                // Include if not marked as not-preferred (and at or above minimum)
                return this.canAssign(p, slot);
            });
            
            // Last resort: if no candidates, take anyone without a shift today
            if (candidates.length === 0) {
                candidates = this.people.filter(p => {
                    const sameDayShifts = this.getSameDayShifts(p, slot);
                    return sameDayShifts.length === 0;
                });
                
                if (candidates.length === 0) {
                    throw new Error(
                        `Cannot schedule slot ${slot.id}: all RAs are already assigned that day`
                    );
                }
                
                slot.warning = 'Assigned despite unavailable date - required coverage';
            }

            // FAIRNESS-FIRST SELECTION
            // Step 1: Find the minimum shift count for this category among candidates
            const minShiftCount = Math.min(...candidates.map(p => 
                currentLoad.get(p.email)[shiftTypeKey]
            ));
            
            // Step 2: ONLY consider candidates at the minimum shift count
            // This ensures fairness - we MUST give shifts to those who have fewer
            let fairCandidates = candidates.filter(p => 
                currentLoad.get(p.email)[shiftTypeKey] === minShiftCount
            );
            
            // Step 3: Sort fair candidates to ensure rotation
            // Primary sort: preference (preferred dates first)
            // Secondary sort: rotate based on shift type to prevent same-alphabet bias
            // Use a combination of slot index and date to create rotation
            const dateNum = parseInt(slot.dateStr.replace(/-/g, ''));
            const slotNum = slot.slotIndex + (slot.role === 'primary' ? 0 : 100);
            const rotationSeed = (dateNum + slotNum) % fairCandidates.length;
            
            const rankedCandidates = fairCandidates.map((person, originalIndex) => {
                const prefs = this.preferences.get(person.email);
                
                // Preference cost
                let prefCost = 0;
                if (prefs && prefs.preferred.has(slot.dateStr)) {
                    prefCost = -5;
                } else if (prefs && prefs.notPreferred.has(slot.dateStr)) {
                    prefCost = 10;
                }
                
                // Rotation: shift the index based on the seed
                const rotatedIndex = (originalIndex + rotationSeed) % fairCandidates.length;
                
                return { person, prefCost, rotatedIndex };
            }).sort((a, b) => {
                // Primary: preference
                if (a.prefCost !== b.prefCost) return a.prefCost - b.prefCost;
                // Secondary: rotated index for fair distribution
                return a.rotatedIndex - b.rotatedIndex;
            });

            const best = rankedCandidates[0];
            
            slot.assignedPerson = best.person;
            slot.cost = best.cost;

            const load = currentLoad.get(best.person.email);
            load[shiftTypeKey]++;
            load.total_hours += slot.duration;

            this.schedule.push(slot);
        }

        this.optimizeWithSwaps(currentLoad, targets);
        
        // Final balancing pass to ensure even distribution
        this.balanceShifts(currentLoad, targets);

        return {
            schedule: this.schedule,
            fairnessReport: this.generateFairnessReport(currentLoad)
        };
    }

    // Optimize schedule by attempting swaps to improve PREFERENCE satisfaction
    // CRITICAL: Never allow swaps that violate fairness (min/max constraints)
    optimizeWithSwaps(currentLoad, targets) {
        const maxIterations = 100;
        let improved = true;
        let iterations = 0;

        while (improved && iterations < maxIterations) {
            improved = false;
            iterations++;

            for (const slot of this.schedule) {
                const currentPerson = slot.assignedPerson;
                const shiftType = this.getShiftTypeKey(slot);
                const target = targets[shiftType];
                const currentPersonLoad = currentLoad.get(currentPerson.email);
                
                // FAIRNESS CHECK: Don't take shifts from someone at or below minimum
                if (currentPersonLoad[shiftType] <= target.min) {
                    continue; // Skip - can't take this shift away
                }

                const currentCost = this.calculateCost(currentPerson, slot, currentLoad, targets);

                // Try swapping with each other RA
                for (const person of this.people) {
                    if (person.email === currentPerson.email) continue;
                    
                    const newPersonLoad = currentLoad.get(person.email);
                    
                    // FAIRNESS CHECK: Don't give more shifts to someone at or above max
                    if (newPersonLoad[shiftType] >= target.max) {
                        continue;
                    }
                    
                    // Skip if preference strongly against (unless they need more shifts)
                    if (!this.canAssign(person, slot) && newPersonLoad[shiftType] >= target.min) {
                        continue;
                    }

                    // Check for same-day conflicts
                    const sameDayShifts = this.schedule.filter(s => 
                        s.id !== slot.id &&
                        s.assignedPerson && 
                        s.assignedPerson.email === person.email && 
                        s.dateStr === slot.dateStr
                    );
                    if (sameDayShifts.length > 0) continue;

                    const swapCost = this.calculateCost(person, slot, currentLoad, targets);

                    // Only swap if significantly better (threshold of 20)
                    if (swapCost < currentCost - 20) {
                        // Update loads
                        currentPersonLoad[shiftType]--;
                        currentPersonLoad.total_hours -= slot.duration;
                        newPersonLoad[shiftType]++;
                        newPersonLoad.total_hours += slot.duration;

                        slot.assignedPerson = person;
                        slot.cost = swapCost;
                        improved = true;
                        break;
                    }
                }
            }
        }
    }

    // Final balancing pass: move shifts from people with more to people with fewer
    // This ensures fair distribution even when initial assignment or swaps leave imbalance
    balanceShifts(currentLoad, targets) {
        const shiftTypes = ['weekday_primary', 'weekend_primary', 'weekday_secondary', 'weekend_secondary'];
        
        for (const shiftType of shiftTypes) {
            let madeChange = true;
            let iterations = 0;
            const maxIterations = 500;
            
            while (madeChange && iterations < maxIterations) {
                madeChange = false;
                iterations++;
                
                // Get all people's counts for this shift type and find min/max
                const counts = this.people.map(p => ({
                    person: p,
                    count: currentLoad.get(p.email)[shiftType]
                }));
                
                const minCount = Math.min(...counts.map(c => c.count));
                const maxCount = Math.max(...counts.map(c => c.count));
                
                // If difference is <= 1, distribution is as fair as possible
                if (maxCount - minCount <= 1) {
                    break;
                }
                
                // Find people with max count (donors) and min count (recipients)
                const donors = counts.filter(c => c.count === maxCount).map(c => c.person);
                const recipients = counts.filter(c => c.count === minCount).map(c => c.person);
                
                // Strategy 1: Direct transfer (donor -> recipient)
                let transferred = false;
                for (const fromPerson of donors) {
                    const slots = this.schedule.filter(s => 
                        s.assignedPerson && 
                        s.assignedPerson.email === fromPerson.email &&
                        this.getShiftTypeKey(s) === shiftType
                    );
                    
                    for (const slot of slots) {
                        // Find a recipient who doesn't have a shift on this day
                        const candidates = recipients.filter(p => {
                            const sameDayShifts = this.schedule.filter(s => 
                                s.id !== slot.id &&
                                s.assignedPerson && 
                                s.assignedPerson.email === p.email && 
                                s.dateStr === slot.dateStr
                            );
                            return sameDayShifts.length === 0;
                        }).sort((a, b) => {
                            const prefsA = this.preferences.get(a.email);
                            const prefsB = this.preferences.get(b.email);
                            const scoreA = prefsA?.preferred.has(slot.dateStr) ? -1 : 
                                          (prefsA?.notPreferred.has(slot.dateStr) ? 1 : 0);
                            const scoreB = prefsB?.preferred.has(slot.dateStr) ? -1 : 
                                          (prefsB?.notPreferred.has(slot.dateStr) ? 1 : 0);
                            return scoreA - scoreB;
                        });
                        
                        const toPerson = candidates.find(p => {
                            const prefs = this.preferences.get(p.email);
                            return !prefs?.notPreferred.has(slot.dateStr);
                        }) || candidates[0];
                        
                        if (toPerson) {
                            const fromLoad = currentLoad.get(fromPerson.email);
                            const toLoad = currentLoad.get(toPerson.email);
                            
                            fromLoad[shiftType]--;
                            fromLoad.total_hours -= slot.duration;
                            toLoad[shiftType]++;
                            toLoad.total_hours += slot.duration;
                            
                            slot.assignedPerson = toPerson;
                            madeChange = true;
                            transferred = true;
                            break;
                        }
                    }
                    if (transferred) break;
                }
                
                // Strategy 2: Triangle swap (donor's slot to intermediary, intermediary's slot to recipient)
                if (!transferred) {
                    for (const donor of donors) {
                        const donorSlots = this.schedule.filter(s => 
                            s.assignedPerson && 
                            s.assignedPerson.email === donor.email &&
                            this.getShiftTypeKey(s) === shiftType
                        );
                        
                        for (const donorSlot of donorSlots) {
                            // Find an intermediary (someone not donor/recipient with same count as average)
                            const avgCount = (minCount + maxCount) / 2;
                            const intermediaries = this.people.filter(p => {
                                const pCount = currentLoad.get(p.email)[shiftType];
                                return p.email !== donor.email && 
                                       !recipients.some(r => r.email === p.email) &&
                                       pCount >= minCount && pCount <= maxCount;
                            });
                            
                            for (const intermediary of intermediaries) {
                                // Check if intermediary can take donor's slot (no same-day conflict)
                                const intHasConflict = this.schedule.some(s => 
                                    s.id !== donorSlot.id &&
                                    s.assignedPerson && 
                                    s.assignedPerson.email === intermediary.email && 
                                    s.dateStr === donorSlot.dateStr
                                );
                                if (intHasConflict) continue;
                                
                                // Find a slot from intermediary that a recipient can take
                                const intSlots = this.schedule.filter(s => 
                                    s.assignedPerson && 
                                    s.assignedPerson.email === intermediary.email &&
                                    this.getShiftTypeKey(s) === shiftType &&
                                    s.dateStr !== donorSlot.dateStr  // Different day
                                );
                                
                                for (const intSlot of intSlots) {
                                    // Find a recipient who can take this slot
                                    const recipient = recipients.find(p => {
                                        const recHasConflict = this.schedule.some(s => 
                                            s.id !== intSlot.id &&
                                            s.assignedPerson && 
                                            s.assignedPerson.email === p.email && 
                                            s.dateStr === intSlot.dateStr
                                        );
                                        return !recHasConflict;
                                    });
                                    
                                    if (recipient) {
                                        // Perform the triangle swap
                                        // 1. Donor's slot -> Intermediary
                                        // 2. Intermediary's slot -> Recipient
                                        const donorLoad = currentLoad.get(donor.email);
                                        const intLoad = currentLoad.get(intermediary.email);
                                        const recLoad = currentLoad.get(recipient.email);
                                        
                                        // Move donor's slot to intermediary
                                        donorLoad[shiftType]--;
                                        donorLoad.total_hours -= donorSlot.duration;
                                        intLoad[shiftType]++;
                                        intLoad.total_hours += donorSlot.duration;
                                        donorSlot.assignedPerson = intermediary;
                                        
                                        // Move intermediary's slot to recipient
                                        intLoad[shiftType]--;
                                        intLoad.total_hours -= intSlot.duration;
                                        recLoad[shiftType]++;
                                        recLoad.total_hours += intSlot.duration;
                                        intSlot.assignedPerson = recipient;
                                        
                                        madeChange = true;
                                        transferred = true;
                                        break;
                                    }
                                }
                                if (transferred) break;
                            }
                            if (transferred) break;
                        }
                        if (transferred) break;
                    }
                }
            }
        }
    }

    // Generate fairness report
    generateFairnessReport(currentLoad) {
        const report = {
            byPerson: [],
            summary: {
                totalShifts: this.schedule.length,
                totalDays: this.generateDates().length,
                weekendDays: this.generateDates().filter(d => this.isWeekendNight(d)).length
            },
            fairnessScore: 0
        };

        for (const person of this.people) {
            const load = currentLoad.get(person.email);
            const prefs = this.preferences.get(person.email);
            
            const assignedSlots = this.schedule.filter(s => 
                s.assignedPerson && s.assignedPerson.email === person.email
            );
            
            let preferredCount = 0;
            let indifferentCount = 0;
            let notPreferredCount = 0;
            
            for (const slot of assignedSlots) {
                if (prefs.preferred.has(slot.dateStr)) {
                    preferredCount++;
                } else if (prefs.notPreferred.has(slot.dateStr)) {
                    notPreferredCount++;
                } else {
                    indifferentCount++;
                }
            }

            report.byPerson.push({
                name: person.name,
                email: person.email,
                weekdayPrimary: load.weekday_primary,
                weekendPrimary: load.weekend_primary,
                weekdaySecondary: load.weekday_secondary,
                weekendSecondary: load.weekend_secondary,
                totalHours: load.total_hours,
                totalShifts: assignedSlots.length,
                preferredAssignments: preferredCount,
                indifferentAssignments: indifferentCount,
                notPreferredAssignments: notPreferredCount
            });
        }

        const avgLoad = this.calculateAverageLoad(currentLoad);
        let variance = 0;
        for (const load of currentLoad.values()) {
            variance += Math.pow(load.weekday_primary - avgLoad.weekday_primary, 2);
            variance += Math.pow(load.weekend_primary - avgLoad.weekend_primary, 2);
            variance += Math.pow(load.weekday_secondary - avgLoad.weekday_secondary, 2);
            variance += Math.pow(load.weekend_secondary - avgLoad.weekend_secondary, 2);
        }
        variance /= (this.people.length * 4);
        
        report.fairnessScore = Math.max(0, Math.round(100 - variance * 10));
        report.averageLoad = avgLoad;

        return report;
    }

    // Normalize date to YYYY-MM-DD string using LOCAL time (not UTC)
    normalizeDate(date) {
        let d;
        if (typeof date === 'string') {
            d = this.parseLocalDate(date);
        } else {
            d = date;
        }
        // Format as YYYY-MM-DD using local date components
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Generate a unique ID
    generateId() {
        return 'id_' + Math.random().toString(36).substr(2, 9);
    }

    // Export schedule to CSV format
    exportToCSV() {
        const rows = [
            ['Date', 'Day', 'Role', 'Slot', 'Weekend', 'Duration (hours)', 'Person Name', 'Person Email']
        ];

        for (const slot of this.schedule) {
            rows.push([
                slot.dateStr,
                this.getDayName(slot.date),
                slot.role,
                slot.slot.toUpperCase(),
                slot.isWeekend ? 'Yes' : 'No',
                slot.duration,
                slot.assignedPerson ? slot.assignedPerson.name : 'UNASSIGNED',
                slot.assignedPerson ? slot.assignedPerson.email : ''
            ]);
        }

        return rows.map(row => row.join(',')).join('\n');
    }

    // Get calendar events for display
    getCalendarEvents(filterPerson = null, filterRole = null) {
        return this.schedule
            .filter(slot => {
                if (filterPerson && (!slot.assignedPerson || slot.assignedPerson.email !== filterPerson)) {
                    return false;
                }
                if (filterRole && slot.role !== filterRole) {
                    return false;
                }
                return true;
            })
            .map(slot => {
                const slotIndex = slot.slotIndex || 0;
                let color;
                if (slot.role === 'primary') {
                    color = this.primaryColors[slotIndex % this.primaryColors.length];
                } else {
                    color = this.secondaryColors[slotIndex % this.secondaryColors.length];
                }
                
                const startDate = new Date(slot.date);
                startDate.setHours(20, 0, 0, 0);
                
                const endDate = new Date(startDate);
                if (slot.isWeekend && slot.role === 'primary') {
                    endDate.setDate(endDate.getDate() + 1);
                    endDate.setHours(20, 0, 0, 0);
                } else {
                    endDate.setDate(endDate.getDate() + 1);
                    endDate.setHours(8, 0, 0, 0);
                }

                return {
                    id: slot.id,
                    title: slot.assignedPerson ? 
                        `${slot.assignedPerson.name} (${slot.role.charAt(0).toUpperCase()}${slot.slot.toUpperCase()})` :
                        `UNASSIGNED (${slot.role.charAt(0).toUpperCase()}${slot.slot.toUpperCase()})`,
                    start: slot.dateStr,
                    backgroundColor: color,
                    borderColor: slot.isWeekend ? '#fbbf24' : color,
                    borderWidth: slot.isWeekend ? 3 : 1,
                    extendedProps: {
                        role: slot.role,
                        slot: slot.slot,
                        slotIndex: slotIndex,
                        isWeekend: slot.isWeekend,
                        duration: slot.duration,
                        person: slot.assignedPerson
                    }
                };
            });
    }

    // Export schedule in format for WhenToWork
    exportForWhenToWork(teamName = 'RAOD') {
        const rows = [
            ['Date', 'Day', 'Start Time', 'End Time', 'Position', 'Employee Name', 'Employee Email']
        ];

        for (const slot of this.schedule) {
            if (!slot.assignedPerson) continue;
            
            const startTime = '8:00 PM';
            let endTime;
            if (slot.isWeekend && slot.role === 'primary') {
                endTime = '8:00 PM';
            } else {
                endTime = '8:00 AM';
            }
            
            const position = `${teamName} - ${slot.role.charAt(0).toUpperCase() + slot.role.slice(1)} ${slot.slot.toUpperCase()}`;
            
            rows.push([
                slot.dateStr,
                this.getDayName(slot.date),
                startTime,
                endTime,
                position,
                slot.assignedPerson.name,
                slot.assignedPerson.email
            ]);
        }

        return rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    }

    // Get shifts organized by week
    getShiftsByWeek() {
        const weeks = {};
        
        for (const slot of this.schedule) {
            if (!slot.assignedPerson) continue;
            
            const date = new Date(slot.date);
            const dayOfWeek = date.getDay();
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - dayOfWeek);
            const weekKey = this.normalizeDate(weekStart);
            
            if (!weeks[weekKey]) {
                weeks[weekKey] = [];
            }
            
            weeks[weekKey].push({
                date: slot.dateStr,
                dayName: this.getDayName(slot.date),
                dayOfWeek: slot.date.getDay(),
                role: slot.role,
                slot: slot.slot,
                isWeekend: slot.isWeekend,
                startTime: '8:00 PM',
                endTime: (slot.isWeekend && slot.role === 'primary') ? '8:00 PM' : '8:00 AM',
                duration: slot.duration,
                person: slot.assignedPerson
            });
        }
        
        return weeks;
    }
}

// Export for use in browser and Node.js
if (typeof window !== 'undefined') {
    window.OnCallScheduler = OnCallScheduler;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OnCallScheduler };
}