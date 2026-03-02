/**
 * @module Jobs/Schedulers/CronScheduler
 *
 * Orchestrateur central des cron jobs du admin-service.
 * Identique au pattern monolith — chaque job est un objet indépendant
 * enregistré ici et exécuté à l'heure prévue.
 *
 * Les jobs appellent les services propriétaires via HTTP plutôt que
 * directement la DB, respectant la séparation des responsabilités microservices.
 */
import cron from 'node-cron';
import { logInfo, logError } from '../../utils/logger.js';

class CronScheduler {
    constructor() {
        this.jobs = new Map();
        this.isRunning = false;
    }

    /**
     * Enregistre un job après validation de son expression cron.
     *
     * @param {{ name: string, schedule: string, execute: Function }} jobConfig
     */
    register(jobConfig) {
        const { name, schedule, execute } = jobConfig;

        if (!name || !schedule || !execute) {
            throw new Error('Job invalide : name, schedule et execute sont requis');
        }

        if (this.jobs.has(name)) {
            logInfo(`[CRON] Job "${name}" déjà enregistré, remplacement`);
            this.unregister(name);
        }

        if (!cron.validate(schedule)) {
            throw new Error(`Expression cron invalide : ${schedule}`);
        }

        const task = cron.schedule(
            schedule,
            async () => {
                const startTime = Date.now();
                try {
                    await execute();
                    logInfo(`[CRON:${name.toUpperCase()}] Terminé en ${Date.now() - startTime}ms`);
                } catch (error) {
                    logError(error, { job: name });
                }
            },
            { scheduled: false, timezone: 'Europe/Paris' }
        );

        this.jobs.set(name, { task, schedule, execute });
        logInfo(`[CRON] Job enregistré : ${name} (${schedule})`);
    }

    registerMany(jobConfigs) {
        jobConfigs.forEach((config) => this.register(config));
    }

    startAll() {
        if (this.isRunning) return;
        this.jobs.forEach((job, name) => {
            job.task.start();
            logInfo(`[CRON] Démarré : ${name.padEnd(20)} -> ${job.schedule}`);
        });
        this.isRunning = true;
        logInfo(`[CRON] ${this.jobs.size} job(s) actif(s)`);
    }

    stopAll() {
        this.jobs.forEach((job, name) => {
            job.task.stop();
            logInfo(`[CRON] Arrêté : ${name}`);
        });
        this.isRunning = false;
    }

    stop(name) {
        const job = this.jobs.get(name);
        if (!job) return false;
        job.task.stop();
        logInfo(`[CRON] Job "${name}" arrêté`);
        return true;
    }

    restart(name) {
        const job = this.jobs.get(name);
        if (!job) return false;
        job.task.stop();
        job.task.start();
        logInfo(`[CRON] Job "${name}" redémarré`);
        return true;
    }

    unregister(name) {
        const job = this.jobs.get(name);
        if (!job) return false;
        job.task.stop();
        job.task.destroy();
        this.jobs.delete(name);
        return true;
    }

    async executeNow(name) {
        const job = this.jobs.get(name);
        if (!job) throw new Error(`Job "${name}" introuvable`);
        logInfo(`[CRON] Exécution manuelle : ${name}`);
        return job.execute();
    }

    listJobs() {
        return Array.from(this.jobs.entries()).map(([name, job]) => ({
            name,
            schedule: job.schedule,
            isRunning: this.isRunning,
        }));
    }
}

export const cronScheduler = new CronScheduler();
