/**
 * @module Controllers/Crons
 *
 * Expose le contrôle manuel des cron jobs (statut, exécution, arrêt, redémarrage).
 * Réservé aux administrateurs — utile pour le debugging et les opérations de maintenance.
 * Le scheduler est piloté directement : aucune couche service supplémentaire
 * n'est nécessaire pour ces opérations de pilotage.
 */
import { cronScheduler } from '../jobs/schedulers/cronScheduler.js';
import { logError } from '../utils/logger.js';

class CronsController {
    /**
     * GET /api/v1/admin/crons
     * Liste tous les crons enregistrés avec leur planning et leur état.
     */
    listJobs = (req, res) => {
        const jobs = cronScheduler.listJobs();
        res.status(200).json({ status: 'success', data: { jobs } });
    };

    /**
     * POST /api/v1/admin/crons/:name/execute
     * Déclenche l'exécution immédiate d'un cron — pour les tests et la maintenance.
     */
    executeJob = async (req, res) => {
        const { name } = req.params;
        const jobs = cronScheduler.listJobs();
        const jobExists = jobs.some((job) => job.name === name);

        if (!jobExists) {
            return res.status(404).json({
                status: 'fail',
                message: `Cron "${name}" introuvable`,
                availableJobs: jobs.map((job) => job.name),
            });
        }

        try {
            const result = await cronScheduler.executeNow(name);
            res.status(200).json({
                status: 'success',
                message: `Cron "${name}" exécuté manuellement`,
                data: { result },
            });
        } catch (err) {
            logError(err, { route: 'POST /admin/crons/:name/execute', cronName: name });
            res.status(500).json({
                status: 'error',
                message: `Erreur lors de l'exécution du cron "${name}"`,
            });
        }
    };

    /**
     * POST /api/v1/admin/crons/:name/stop
     * Arrête un cron planifié sans le supprimer du scheduler.
     */
    stopJob = (req, res) => {
        const { name } = req.params;
        const success = cronScheduler.stop(name);

        if (!success) {
            return res.status(404).json({
                status: 'fail',
                message: `Cron "${name}" introuvable`,
            });
        }

        res.status(200).json({
            status: 'success',
            message: `Cron "${name}" arrêté`,
        });
    };

    /**
     * POST /api/v1/admin/crons/:name/restart
     * Redémarre un cron précédemment arrêté.
     */
    restartJob = (req, res) => {
        const { name } = req.params;
        const success = cronScheduler.restart(name);

        if (!success) {
            return res.status(404).json({
                status: 'fail',
                message: `Cron "${name}" introuvable`,
            });
        }

        res.status(200).json({
            status: 'success',
            message: `Cron "${name}" redémarré`,
        });
    };
}

export const cronsController = new CronsController();
