const EventEmitter = require('events');

class PerformanceMonitor extends EventEmitter {
    constructor(options = {}) {
        super();

        this.thresholds = {
            memoryMB: options.memoryThreshold || 256,
            cpuPercent: options.cpuThreshold || 80,
            responseTimeMs: options.responseThreshold || 5000,
            ...options.thresholds
        };

        this.metrics = {
            startTime: Date.now(),
            requestCount: 0,
            memoryPeak: 0,
            cpuHistory: [],
            responseTimeHistory: [],
            lastCleanup: Date.now()
        };

        this.isLogging = process.env.NODE_ENV !== 'production';
        this.intervalId = null;

        this.startMonitoring();
    }

    startMonitoring() {
        this.intervalId = setInterval(() => {
            this.checkPerformance();
        }, 30000);

        this.log('🔍 Performance Monitor iniciado');
    }

    checkPerformance() {
        const memUsage = process.memoryUsage();
        const memMB = memUsage.heapUsed / 1024 / 1024;

        this.metrics.memoryPeak = Math.max(this.metrics.memoryPeak, memMB);

        if (memMB > this.thresholds.memoryMB) {
            this.emit('highMemory', { memoryMB: memMB, threshold: this.thresholds.memoryMB });
            this.triggerCleanup();
        }

        const now = Date.now();
        if (now - this.metrics.lastCleanup > 600000) {
            this.performMaintenance();
        }
    }

    recordRequest(responseTime) {
        this.metrics.requestCount++;
        this.metrics.responseTimeHistory.push(responseTime);

        if (this.metrics.responseTimeHistory.length > 50) {
            this.metrics.responseTimeHistory.shift();
        }

        if (responseTime > this.thresholds.responseTimeMs) {
            this.emit('slowResponse', { responseTime, threshold: this.thresholds.responseTimeMs });
        }
    }

    triggerCleanup() {
        this.log('🧹 Iniciando limpeza automática por alto uso de memória');

        if (global.gc) {
            global.gc();
        }

        this.emit('cleanup');
        this.metrics.lastCleanup = Date.now();
    }

    performMaintenance() {
        this.log('🔧 Executando manutenção automática');

        this.metrics.responseTimeHistory = this.metrics.responseTimeHistory.slice(-20);
        this.metrics.cpuHistory = this.metrics.cpuHistory.slice(-20);

        if (global.gc) {
            global.gc();
        }

        this.metrics.lastCleanup = Date.now();
        this.emit('maintenance');
    }

    getStats() {
        const memUsage = process.memoryUsage();
        const avgResponseTime = this.metrics.responseTimeHistory.length > 0
            ? this.metrics.responseTimeHistory.reduce((a, b) => a + b) / this.metrics.responseTimeHistory.length
            : 0;

        return {
            uptime: Date.now() - this.metrics.startTime,
            requests: this.metrics.requestCount,
            memoryMB: Math.round(memUsage.heapUsed / 1024 / 1024),
            memoryPeakMB: Math.round(this.metrics.memoryPeak),
            avgResponseTime: Math.round(avgResponseTime),
            isHealthy: memUsage.heapUsed / 1024 / 1024 < this.thresholds.memoryMB
        };
    }

    log(message) {
        if (this.isLogging) {
            console.log(`[PERF] ${message}`);
        }
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.log('🛑 Performance Monitor parado');
    }
}

module.exports = PerformanceMonitor;