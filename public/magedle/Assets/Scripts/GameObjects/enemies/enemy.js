class Enemy extends ImageObject {
    sizes = ['Smol', 'Middle', 'Big', 'King'];
    hpBar;
    currentHealthPoints = 100;
    maxHealthPoints = 100;

    movementSpeed = 0.5;

    origin = {
        x: 0,
        y: 0
    }

    attackSpeed = 2500;
    attackDamage = 100;
    touchingBarrier = false;
    timeStampLastTimeDealtDamage = 0;
    expPoints = 20;

    constructor(name, src, x, y, width, height) {
        super(name, src, x, y, width, height);
        this.hpBar = new HPBar(x, y, width, height+5);
        this.hpBar.enemy = this;
        this.origin.x = x;
        this.origin.y = y;
        this.attackDamage = monsters[name].attackDamage;
        waveManager.addEnemy(this);

        this.currentHealthPoints *= Math.sqrt(waveManager.currentWaveNo)*1.5 * Math.pow(monsters[name].size,5);
        this.maxHealthPoints = this.currentHealthPoints;
        this.movementSpeed = 0.5;
        this.movementSpeed /= Math.pow(monsters[name].size, 2);
    }

    update() {
        this.bindHPBarPositionToEnemyPosition();
        this.moveTowardsBottomMid();

        if (this.touchingBarrier) {
            if (this.timeStampLastTimeDealtDamage + this.attackSpeed < Date.now()) {
                this.timeStampLastTimeDealtDamage = Date.now();
                gameManager.magicBarrier.receiveDamage(this.attackDamage);
            }
        }
    }

    bindHPBarPositionToEnemyPosition() {
        this.hpBar.position.x = this.position.x;
        this.hpBar.position.y = this.position.y + this.hpBar.offsetY;

        this.hpBar.border.position.x = this.position.x;
        this.hpBar.border.position.y = this.position.y + this.hpBar.offsetY;
    }

    moveTowardsBottomMid() {
        let directionX = gameManager.gameCanvas.canvasBoundaries.right / 2 - this.origin.x;
        let directionY = gameManager.gameCanvas.canvasBoundaries.bottom - this.origin.y;

        let directionVectorLength = Math.sqrt(directionX * directionX + directionY * directionY);

        let directionXNormalised = (directionX) / directionVectorLength;
        let directionYNormalised = (directionY) / directionVectorLength;

        this.position.x += directionXNormalised * this.movementSpeed * gameManager.deltaTime;
        this.position.y += directionYNormalised * this.movementSpeed * gameManager.deltaTime;
    }

    onCollision(otherObject) {
        if (otherObject.name === "magicBarrier") {
            this.movementSpeed = 0;
            this.touchingBarrier = true;
        }
    }

    receiveDamage(damage) {
        this.currentHealthPoints -= damage;
        this.hpBar.dimensions.width = this.hpBar.border.dimensions.width * (this.currentHealthPoints / this.maxHealthPoints);

        new FadingTextPopUp("-" + Math.floor(damage), this.position.x + this.dimensions.width, this.position.y - 20, 35);

        if (this.currentHealthPoints <= 0) {
            this.die(true);
        }
    }

    die(isPlayerSourceOfDamage = false) {
        waveManager.addToCounterOfDefeatedEnemies();
        if (isPlayerSourceOfDamage) {
            this.dropLoot();
            playerManager.gainExperience(this.expPoints);
        }
        this.destroy();
        this.hpBar.destroy();
        this.hpBar.border.destroy();
    }

    dropLoot() {
        let numb = Math.random();
        if (numb <= waveManager.chanceThatEnemyDropsGold) {
            gameManager.dropGoldCoin(this.position.x, this.position.y);
        }
        numb = Math.random();
        if (numb <= waveManager.chanceThatEnemyDropsItem) {
            gameManager.dropItem(waveManager.getRandomItemNameWithTierFromItems(1), this.position.x+20, this.position.y);
        }
    }

    getSizeName(){
        for (let i = 0; i < this.sizes.length; i++) {
            if (this.name.includes(this.sizes[i])){
                return this.sizes[i];
            }
        }
    }
}