class BossEnemy extends Enemy {
    timeStampLastTimeEnemySpawned = 0;
    delayBetweenMonsterSpawns = 5000;
    spawnAbleEnemies = [];
    spawnedHelplings = [];
    defeated = false;

    constructor(name) {
        super(name, "./Enemies/" + name + ".png", gameManager.gameCanvas.canvasBoundaries.right / 2 - (monsters[name].size * waveManager.enemyDefaultSize) / 2, 130, waveManager.enemyDefaultSize * monsters[name].size, waveManager.enemyDefaultSize * monsters[name].size);
        this.currentHealthPoints = 100 * Math.sqrt(waveManager.currentWaveNo) * Math.pow(monsters[name].size, 4);
        this.maxHealthPoints = this.currentHealthPoints;
        this.heightOrigin = this.dimensions.height;
        this.movementSpeed = 0;
        this.initializeSpawnAbleEnemies();
        waveManager.currentBoss = this;
    }

    update() {
        super.update();
        this.spawnEnemies();
    }

    spawnEnemies() {
        if (this.timeStampLastTimeEnemySpawned + this.delayBetweenMonsterSpawns < Date.now()) {
            this.spawnSingleEnemy();
            this.timeStampLastTimeEnemySpawned = Date.now();
        }
    }

    spawnSingleEnemy() {
        let randomMinion = Math.random();
        switch (this.name) {
            case "SlimeKing":
                if (randomMinion <= 0.10) {
                    this.spawnedHelplings.push(new Slime(this.spawnAbleEnemies[0]));
                } else if (randomMinion <= 0.35) {
                    this.spawnedHelplings.push(new Slime(this.spawnAbleEnemies[1]));
                } else {
                    this.spawnedHelplings.push(new Slime(this.spawnAbleEnemies[2]));
                }
                break;
            case "CrystalKing":
                if (randomMinion <= 0.10) {
                    this.spawnedHelplings.push(new Crystal(this.spawnAbleEnemies[0]));
                } else if (randomMinion <= 0.35) {
                    this.spawnedHelplings.push(new Crystal(this.spawnAbleEnemies[1]));
                } else {
                    this.spawnedHelplings.push(new Crystal(this.spawnAbleEnemies[2]));
                }
                break;
        }

    }

    initializeSpawnAbleEnemies() {
        switch (this.name) {
            case "SlimeKing":
                this.spawnAbleEnemies = ['SlimeBig', 'SlimeMiddle', 'SlimeSmol'];
                break;
            case "CrystalKing":
                this.spawnAbleEnemies = ['CrystalBig', 'CrystalMiddle', 'CrystalSmol'];
                break;
        }
    }

    die(isPlayerSourceOfDamage = false) {
        super.die(isPlayerSourceOfDamage);
        this.defeated = true;
        this.spawnedHelplings.forEach(value => value.die());
        this.spawnedHelplings = [];
    }
}