class WaveManager {
    enemies = [];
    itemsOnTheFloor = [];

    initialDelayToStartWave = 3000;
    timeBetweenMonsterSpawn = 1500;

    waveActive = false;
    currentWaveNo = 1;

    defeatedEnemiesCounter = 0;
    enemyDefaultSize = 80;

    chanceThatEnemyDropsGold = 0.5;
    chanceThatEnemyDropsItem = 0.2;

    waveMultiplierIfOverLimit = 1;
    
    chanceThatTheMerchantAppears = 1;
    merchant;

    currentBoss = undefined;

    constructor() {
        console.log("Enemy-Manager created!");
    }

    addEnemy(newEnemy) {
        this.enemies.push(newEnemy);
    }

    startWave() {
        this.itemsOnTheFloor.forEach(value => value.destroy());
        gameManager.magicBarrier.reactivateBarrier();
        gameManager.waveButton.disabled = true;
        gameManager.waveButton.innerHTML = "Wave " + this.getCurrentWaveText() + " active"
        this.waveActive = true;

        this.spawnMonsters();

        gameManager.titleObject.displayNewTitle("Wave " + this.getCurrentWaveText());
        if (this.merchant !== undefined) {
            this.merchant.destroy();
            this.merchant = undefined;
        }
    }

    spawnMonsters() {
        let amountOfEnemiesSpawned = 0;
        let multiplierOfEnemies = (this.currentWaveNo % 10 === 0 ? 1 : this.waveMultiplierIfOverLimit);

        for (let i = 0; i < multiplierOfEnemies; i++) {
            waveConfig[this.currentWaveNo - 1].enemies.forEach(enemy => {
                for (let i = 0; i < enemy.amount; i++) {
                    amountOfEnemiesSpawned++;
                    setTimeout(function () {
                        if (waveManager.waveActive) {
                            waveManager.spawnMonsterFromType(enemy);
                        }
                    }, this.timeBetweenMonsterSpawn * (amountOfEnemiesSpawned) + this.initialDelayToStartWave);
                }
            });
        }
    }

    spawnMonsterFromType(enemy) {
        switch (enemy.type) {
            case "Slime":
                new Slime(enemy.name);
                break;
            case "SlimeKing":
                new SlimeKing(enemy.name);
                break;
            case "Crystal":
                new Crystal(enemy.name);
                break;
            case "CrystalKing":
                new CrystalKing(enemy.name);
                break;
        }
    }

    checkIfWaveDone() {
        if (this.currentBoss !== undefined) {
            if(this.currentBoss.defeated === true){
                this.currentWaveNo++;
                if (this.currentWaveNo > waveConfig.length) {
                    this.currentWaveNo = 1;
                    this.waveMultiplierIfOverLimit++;
                }
                gameManager.titleObject.displayNewTitle("Wave cleared!");
                this.resetWave();
                this.currentBoss = undefined;
            }
        } else {
            if (this.defeatedEnemiesCounter >= this.getTotalAmountOfEnemiesFromCurrentWave()) {
                this.currentWaveNo++;
                if (this.currentWaveNo > waveConfig.length) {
                    this.currentWaveNo = 1;
                    this.waveMultiplierIfOverLimit++;
                }
                gameManager.titleObject.displayNewTitle("Wave cleared!");
                this.resetWave();
            }
        }
        if (gameManager.magicBarrier.currentHealthPoints <= 0) {
            this.enemies.forEach(value => value.die())
            gameManager.titleObject.displayNewTitle("Wave failed!");
            this.resetWave();
        }
    }

    resetWave() {
        gameManager.magicBarrier.deactivateBarrier();
        gameManager.magicBarrier.regen500HealthPoints();
        this.waveActive = false;
        this.defeatedEnemiesCounter = 0;
        gameManager.waveButton.disabled = false;
        gameManager.waveButton.innerHTML = "Start wave " + this.getCurrentWaveText();

        let randomNumber = Math.random();
        console.log("Lucky number was " + randomNumber);
        if (randomNumber <= this.chanceThatTheMerchantAppears) {
            this.merchant = new Merchant();
        }
    }

    addToCounterOfDefeatedEnemies() {
        this.defeatedEnemiesCounter++;
    }

    trackDefeatedEnemies() {
        gameManager.gameCanvas.drawLayer.save();
        gameManager.gameCanvas.drawLayer.font = 'bold 25px \'MedievalSharp\'';
        gameManager.gameCanvas.drawLayer.fillStyle = 'black';
        gameManager.gameCanvas.drawLayer.textAlign = 'right';
        gameManager.gameCanvas.drawLayer.fillText("Enemies: " + this.defeatedEnemiesCounter + "/" + this.getTotalAmountOfEnemiesFromCurrentWave(), gameCanvas.canvasBoundaries.right - 10, 30);
        gameManager.gameCanvas.drawLayer.restore();
    }

    getTotalAmountOfEnemiesFromCurrentWave() {
        let sumOfEnemies = 0;
        waveConfig[this.currentWaveNo - 1].enemies.forEach(enemy => sumOfEnemies += enemy.amount);
        if (this.currentWaveNo % 10 === 0) {
            return sumOfEnemies;
        } else {
            return sumOfEnemies * this.waveMultiplierIfOverLimit;
        }
    }

    getRandomItemNameWithTierFromItems(tier) {
        let allItems = [];
        for (let itemCategory in items) {
            allItems[itemCategory] = [];
            for (let item in items[itemCategory]) {
                if (items[itemCategory][item].tier === tier) {
                    allItems[itemCategory].push(item)
                }
            }
        }

        let randomCategoryNumb = Math.floor(Math.random() * 4);
        let randomItemNumb = Math.floor(Math.random() * allItems[getItemCategoryFromIndex(randomCategoryNumb)].length);
        return getItemCategoryFromIndex(randomCategoryNumb) + ":" + allItems[getItemCategoryFromIndex(randomCategoryNumb)][randomItemNumb];
    }

    getCurrentWaveText() {
        return this.currentWaveNo + waveConfig.length * (this.waveMultiplierIfOverLimit - 1);
    }
}