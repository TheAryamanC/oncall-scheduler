// Test suite

// Import scheduler (for Node.js testing)
if (typeof require !== 'undefined') {
    // Node.js environment - would need to load scheduler.js
}

// Test configuration
const TEST_CONFIGS = {
    teamSizes: [5, 8, 10, 15, 20, 30, 50],
    dateRanges: [
        { weeks: 1, label: '1 week' },
        { weeks: 2, label: '2 weeks' },
        { weeks: 4, label: '1 month' },
        { weeks: 8, label: '2 months' },
        { weeks: 13, label: '3 months' },
        { weeks: 26, label: '6 months' },
        { weeks: 52, label: '12 months' }
    ],
    shiftCounts: [0, 1, 2, 3, 5, 10]
};

// Test result tracking
let testResults = {
    passed: 0,
    failed: 0,
    errors: []
};

// Generate random preferences for a person
function generateRandomPreferences(dates, allNotPreferred = false) {
    const preferred = [];
    const notPreferred = [];
    
    if (allNotPreferred) {
        // This RA marks ALL dates as not preferred
        notPreferred.push(...dates);
    } else {
        for (const date of dates) {
            const rand = Math.random();
            if (rand < 0.3) {
                preferred.push(date);
            } else if (rand < 0.5) {
                notPreferred.push(date);
            }
            // Otherwise neutral (neither preferred nor not preferred)
        }
    }
    
    return { preferred, notPreferred };
}

// Check fairness of shift distribution
function checkFairness(shiftCounts, totalShifts, numPeople, shiftType) {
    const minExpected = Math.floor(totalShifts / numPeople);
    const maxExpected = Math.ceil(totalShifts / numPeople);
    
    const issues = [];
    for (const [email, count] of Object.entries(shiftCounts)) {
        if (count < minExpected || count > maxExpected) {
            issues.push({
                email,
                count,
                expected: `${minExpected}-${maxExpected}`,
                shiftType
            });
        }
    }
    
    return issues;
}

// Run a single test configuration
function runTest(config) {
    const { teamSize, weeks, primaryCount, secondaryCount, testName } = config;
    
    try {
        const scheduler = new OnCallScheduler();
        scheduler.setShiftCounts(primaryCount, secondaryCount);
        
        // Set date range
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + (weeks * 7) - 1);
        scheduler.setDateRange(startDate, endDate);
        
        // Add people
        for (let i = 0; i < teamSize; i++) {
            scheduler.addPerson(`RA ${i + 1}`, `ra${i + 1}@example.com`);
        }
        
        // Generate dates for preferences
        const dates = scheduler.generateDates().map(d => scheduler.normalizeDate(d));
        
        // Set preferences - make 1 in 5 RAs mark all dates as not preferred
        for (let i = 0; i < teamSize; i++) {
            const allNotPreferred = (i % 5 === 0); // Every 5th RA marks all as not preferred
            const prefs = generateRandomPreferences(dates, allNotPreferred);
            scheduler.setPreferences(`ra${i + 1}@example.com`, prefs.preferred, prefs.notPreferred);
        }
        
        // Generate schedule
        const result = scheduler.generateSchedule();
        
        // Count shifts by type for each person
        const shiftsByPerson = {
            weekday_primary: {},
            weekend_primary: {},
            weekday_secondary: {},
            weekend_secondary: {}
        };
        
        // Initialize counts
        for (let i = 0; i < teamSize; i++) {
            const email = `ra${i + 1}@example.com`;
            shiftsByPerson.weekday_primary[email] = 0;
            shiftsByPerson.weekend_primary[email] = 0;
            shiftsByPerson.weekday_secondary[email] = 0;
            shiftsByPerson.weekend_secondary[email] = 0;
        }
        
        // Count total shifts by type
        const totalShifts = {
            weekday_primary: 0,
            weekend_primary: 0,
            weekday_secondary: 0,
            weekend_secondary: 0
        };
        
        // Count actual assignments
        for (const slot of result.schedule) {
            if (slot.assignedPerson) {
                const key = scheduler.getShiftTypeKey(slot);
                shiftsByPerson[key][slot.assignedPerson.email]++;
                totalShifts[key]++;
            }
        }
        
        // Check fairness for each shift type
        const allIssues = [];
        for (const shiftType of ['weekday_primary', 'weekend_primary', 'weekday_secondary', 'weekend_secondary']) {
            const issues = checkFairness(shiftsByPerson[shiftType], totalShifts[shiftType], teamSize, shiftType);
            allIssues.push(...issues);
        }
        
        if (allIssues.length > 0) {
            testResults.failed++;
            testResults.errors.push({
                test: testName,
                issues: allIssues
            });
            return { success: false, issues: allIssues };
        }
        
        testResults.passed++;
        return { success: true };
        
    } catch (error) {
        testResults.failed++;
        testResults.errors.push({
            test: testName,
            error: error.message
        });
        return { success: false, error: error.message };
    }
}

// Run all test combinations
function runAllTests() {
    console.log('='.repeat(60));
    console.log('STARTING COMPREHENSIVE SCHEDULER TESTS');
    console.log('='.repeat(60));
    
    testResults = { passed: 0, failed: 0, errors: [] };
    
    let testCount = 0;
    const totalTests = TEST_CONFIGS.teamSizes.length * 
                       TEST_CONFIGS.dateRanges.length * 
                       TEST_CONFIGS.shiftCounts.length * 
                       TEST_CONFIGS.shiftCounts.length;
    
    console.log(`Running ${totalTests} test combinations...\n`);
    console.log('Ignoring invalid configurations...\n');
    
    for (const teamSize of TEST_CONFIGS.teamSizes) {
        for (const dateRange of TEST_CONFIGS.dateRanges) {
            for (const primaryCount of TEST_CONFIGS.shiftCounts) {
                for (const secondaryCount of TEST_CONFIGS.shiftCounts) {
                    // Skip invalid configurations (need at least enough RAs)
                    if (teamSize < primaryCount + secondaryCount) {
                        continue;
                    }
                    
                    testCount++;
                    const testName = `Team=${teamSize}, Range=${dateRange.label}, Primary=${primaryCount}, Secondary=${secondaryCount}`;
                    
                    const result = runTest({
                        teamSize,
                        weeks: dateRange.weeks,
                        primaryCount,
                        secondaryCount,
                        testName
                    });
                    
                    const status = result.success ? 'PASS' : 'FAIL';
                    if (!result.success) {
                        console.log(`[${status}] ${testName}`);
                        if (result.issues) {
                            result.issues.slice(0, 3).forEach(issue => {
                                console.log(`       ${issue.email}: ${issue.shiftType} = ${issue.count} (expected ${issue.expected})`);
                            });
                            if (result.issues.length > 3) {
                                console.log(`       ... and ${result.issues.length - 3} more issues`);
                            }
                        }
                        if (result.error) {
                            console.log(`       Error: ${result.error}`);
                        }
                    }
                    
                    // Progress update every 50 tests
                    if (testCount % 50 === 0) {
                        console.log(`Progress: ${testCount}/${totalTests} tests completed...`);
                    }
                }
            }
        }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total tests run: ${testResults.passed + testResults.failed}`);
    console.log(`Passed: ${testResults.passed}`);
    console.log(`Failed: ${testResults.failed}`);
    
    if (testResults.failed > 0) {
        console.log('\nFailed tests:');
        testResults.errors.forEach((err, i) => {
            console.log(`\n${i + 1}. ${err.test}`);
            if (err.issues) {
                err.issues.forEach(issue => {
                    console.log(`   - ${issue.email}: ${issue.shiftType} = ${issue.count} (expected ${issue.expected})`);
                });
            }
            if (err.error) {
                console.log(`   Error: ${err.error}`);
            }
        });
    }
    
    console.log('\n' + '='.repeat(60));
    
    return testResults;
}

// Run a quick smoke test with limited configurations
function runQuickTest() {
    console.log('Running quick smoke test...\n');
    
    testResults = { passed: 0, failed: 0, errors: [] };
    
    const quickConfigs = [
        { teamSize: 5, weeks: 1, primaryCount: 1, secondaryCount: 1 },
        { teamSize: 8, weeks: 2, primaryCount: 2, secondaryCount: 2 },
        { teamSize: 10, weeks: 4, primaryCount: 2, secondaryCount: 2 },
        { teamSize: 15, weeks: 4, primaryCount: 3, secondaryCount: 3 },
        { teamSize: 20, weeks: 8, primaryCount: 2, secondaryCount: 2 },
        { teamSize: 30, weeks: 4, primaryCount: 5, secondaryCount: 5 },
        { teamSize: 50, weeks: 4, primaryCount: 10, secondaryCount: 10 },
        // Edge cases
        { teamSize: 5, weeks: 52, primaryCount: 1, secondaryCount: 1 }, // Long range, small team
        { teamSize: 50, weeks: 1, primaryCount: 10, secondaryCount: 10 }, // Large team, short range
        { teamSize: 10, weeks: 4, primaryCount: 5, secondaryCount: 4 }, // Max shifts for team
        // Zero RA tests
        { teamSize: 5, weeks: 2, primaryCount: 0, secondaryCount: 1 }, // No primary RAs
        { teamSize: 5, weeks: 2, primaryCount: 1, secondaryCount: 0 }, // No secondary RAs
        { teamSize: 5, weeks: 2, primaryCount: 0, secondaryCount: 0 }, // No RAs at all
    ];
    
    for (const config of quickConfigs) {
        const testName = `Team=${config.teamSize}, Weeks=${config.weeks}, P=${config.primaryCount}, S=${config.secondaryCount}`;
        const result = runTest({ ...config, testName });
        
        const status = result.success ? 'PASS' : 'FAIL';
        console.log(`[${status}] ${testName}`);
        
        if (!result.success && result.issues) {
            result.issues.forEach(issue => {
                console.log(`       ${issue.email}: ${issue.shiftType} = ${issue.count} (expected ${issue.expected})`);
            });
        }
    }
    
    console.log(`\nQuick test complete: ${testResults.passed} passed, ${testResults.failed} failed`);
    return testResults;
}

// Test case: All RAs mark all dates as not preferred
function testAllNotPreferred() {
    console.log('\nTesting: All RAs mark all dates as not preferred\n');
    
    const scheduler = new OnCallScheduler();
    scheduler.setShiftCounts(2, 2);
    
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 13); // 2 weeks
    scheduler.setDateRange(startDate, endDate);
    
    // Add 8 people
    for (let i = 0; i < 8; i++) {
        scheduler.addPerson(`RA ${i + 1}`, `ra${i + 1}@example.com`);
    }
    
    // Generate dates
    const dates = scheduler.generateDates().map(d => scheduler.normalizeDate(d));
    
    // ALL RAs mark ALL dates as not preferred
    for (let i = 0; i < 8; i++) {
        scheduler.setPreferences(`ra${i + 1}@example.com`, [], dates);
    }
    
    // Generate schedule
    const result = scheduler.generateSchedule();
    
    // Print shift distribution
    console.log('Shift distribution when ALL RAs mark ALL dates as not preferred:');
    console.log('-'.repeat(70));
    
    for (const person of result.fairnessReport.byPerson) {
        console.log(`${person.name}: WD-P=${person.weekdayPrimary}, WE-P=${person.weekendPrimary}, WD-S=${person.weekdaySecondary}, WE-S=${person.weekendSecondary}`);
    }
    
    console.log('-'.repeat(70));
    console.log('Fairness Score:', result.fairnessReport.fairnessScore);
    
    // Check if distribution is fair
    const weekdayPrimaryValues = result.fairnessReport.byPerson.map(p => p.weekdayPrimary);
    const weekendPrimaryValues = result.fairnessReport.byPerson.map(p => p.weekendPrimary);
    const weekdaySecondaryValues = result.fairnessReport.byPerson.map(p => p.weekdaySecondary);
    const weekendSecondaryValues = result.fairnessReport.byPerson.map(p => p.weekendSecondary);
    
    const checkVariance = (values, name) => {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const variance = max - min;
        const status = variance <= 1 ? 'PASS' : 'FAIL';
        console.log(`[${status}] ${name}: min=${min}, max=${max}, variance=${variance} (should be <= 1)`);
        return variance <= 1;
    };
    
    console.log('\nFairness checks:');
    const allPass = checkVariance(weekdayPrimaryValues, 'Weekday Primary') &&
                    checkVariance(weekendPrimaryValues, 'Weekend Primary') &&
                    checkVariance(weekdaySecondaryValues, 'Weekday Secondary') &&
                    checkVariance(weekendSecondaryValues, 'Weekend Secondary');
    
    return allPass;
}

// Export for use in browser console
if (typeof window !== 'undefined') {
    window.runAllTests = runAllTests;
    window.runQuickTest = runQuickTest;
    window.testAllNotPreferred = testAllNotPreferred;
}

// Run tests if executed directly in browser
if (typeof document !== 'undefined') {
    console.log('Test suite loaded. Available functions:');
    console.log('  runQuickTest() - Run a quick smoke test (10 configs)');
    console.log('  runAllTests() - Run full test suite (all combinations)');
    console.log('  testAllNotPreferred() - Test when all RAs mark all dates as not preferred');
}

// Run tests if executed in Node.js
if (typeof require !== 'undefined' && require.main === module) {
    // Load the scheduler
    const { OnCallScheduler } = require('../scheduler.js');
    global.OnCallScheduler = OnCallScheduler;
    
    // Run quick test by default, or full test if --full flag
    const args = process.argv.slice(2);
    if (args.includes('--full')) {
        runAllTests();
    } else if (args.includes('--all-not-preferred')) {
        testAllNotPreferred();
    } else {
        runQuickTest();
    }
}