export interface SchedulePreset {
    key: string;
    label: string;
    description: string;
    cron: string | null;
    humanizeDelay: number;
    icon: string;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
    {
        key: "weekday_morning",
        label: "Every weekday morning",
        description: "Runs Mon–Fri at the start of your workday",
        cron: "0 9 * * 1-5",
        humanizeDelay: 15,
        icon: "sunrise",
    },
    {
        key: "weekday_evening",
        label: "Every weekday evening",
        description: "Runs Mon–Fri at end of your workday",
        cron: "0 18 * * 1-5",
        humanizeDelay: 10,
        icon: "sunset",
    },
    {
        key: "daily_noon",
        label: "Every day at noon",
        description: "Runs daily at 12:00 PM",
        cron: "0 12 * * *",
        humanizeDelay: 5,
        icon: "sun",
    },
    {
        key: "monday_morning",
        label: "Every Monday morning",
        description: "Weekly kickoff — runs Monday at 9 AM",
        cron: "0 9 * * 1",
        humanizeDelay: 15,
        icon: "calendar",
    },
    {
        key: "friday_afternoon",
        label: "Every Friday afternoon",
        description: "Weekly wrap-up — runs Friday at 4 PM",
        cron: "0 16 * * 5",
        humanizeDelay: 20,
        icon: "calendar",
    },
    {
        key: "twice_daily",
        label: "Twice a day",
        description: "Runs at 9 AM and 3 PM on weekdays",
        cron: "0 9,15 * * 1-5",
        humanizeDelay: 10,
        icon: "repeat",
    },
    {
        key: "hourly_business",
        label: "Every hour during business hours",
        description: "Runs every hour Mon–Fri 9 AM–6 PM",
        cron: "0 9-18 * * 1-5",
        humanizeDelay: 5,
        icon: "clock",
    },
    {
        key: "first_of_month",
        label: "First of every month",
        description: "Runs on the 1st of each month at 9 AM",
        cron: "0 9 1 * *",
        humanizeDelay: 15,
        icon: "calendar-check",
    },
    {
        key: "every_30min_business",
        label: "Every 30 minutes (business hours)",
        description: "Runs every 30 min Mon–Fri 9 AM–6 PM",
        cron: "*/30 9-18 * * 1-5",
        humanizeDelay: 0,
        icon: "zap",
    },
    {
        key: "custom",
        label: "Custom schedule",
        description: "Describe your own schedule in plain English",
        cron: null,
        humanizeDelay: 0,
        icon: "pencil",
    },
];
