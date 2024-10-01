class Player extends ImageObject {
    timeStampLastTimeAttackBallFired = 0;
    isShooting = false;

    mousePosX;
    mousePosY;

    velocity = {
        xLeft: 0,
        xRight: 0,
        yUp: 0,
        yDown: 0
    };

    columnsOnSpriteSheet = {
        BACK: 0,
        FRONT: 1,
        RIGHT: 2,
        LEFT: 3
    };


    playerSafeZone = undefined;

    constructor(x, y, width, height) {
        super("player", "Mage.png", x, y, width, height, 720, 1024, 50, true);
        console.log("PlayerFigure has been created");
        this.playerSafeZone = new GameObject("safezone", gameManager.castle.safeZone.position.x, gameManager.castle.safeZone.position.y + this.dimensions.height, gameManager.castle.dimensions.width, gameManager.castle.dimensions.height - this.dimensions.height);

    }

    update() {
        this.move();
        this.isThePlayerInTheSafeZone();
        if (this.isShooting && waveManager.waveActive) {
            this.shoot();
            this.currentColumnInSpriteSheet = this.columnsOnSpriteSheet.BACK;
        }

        if (waveManager.waveActive === false) {
            gameManager.waveButton.disabled = !this.isThePlayerInTheSafeZone();
        }

        if (uiManager.currentPage instanceof ItemOnFloor) {
            if (!this.isCollidingWith(uiManager.currentPage)) {
                uiManager.currentPage = undefined;
                uiManager.initializePage();
            }
        }

        if(uiManager.currentPage instanceof Merchant){
            if (!this.isCollidingWith(uiManager.currentPage.shopArea)) {
                uiManager.currentPage = undefined;
                uiManager.initializePage();
            }
        }
    }

    shoot() {
        if (this.timeStampLastTimeAttackBallFired + playerManager.getSpellCastRate() < Date.now()) {
            new AttackBall("attackBall", "FireBall.png", 80, this.mousePosX, this.mousePosY);
            this.timeStampLastTimeAttackBallFired = Date.now();
        }
    }

    onCollision(otherObject) {
        if (otherObject.name === "wall" && otherObject.isActive === true) {
            this.reStorePosition();
        }
    }

    move() {
        this.showRotatedMageAccordingToVelocity();
        this.position.x += (this.velocity.xRight - this.velocity.xLeft) * playerManager.movementSpeed * this.getUnitFactorIfWalkingDiagonal() * gameManager.deltaTime;
        this.position.y += (this.velocity.yDown - this.velocity.yUp) * playerManager.movementSpeed * this.getUnitFactorIfWalkingDiagonal() * gameManager.deltaTime;
    }

    isThePlayerInTheSafeZone() {
        return this.isCollidingWith(this.playerSafeZone);
    }

    getUnitFactorIfWalkingDiagonal() {
        if (Math.pow(this.velocity.xRight - this.velocity.xLeft, 2) === 1 && Math.pow(this.velocity.yDown - this.velocity.yUp, 2) === 1) {
            return 0.66;
        }
        return 1;
    }

    showRotatedMageAccordingToVelocity() {
        if (this.velocity.yDown) {
            this.currentColumnInSpriteSheet = this.columnsOnSpriteSheet.FRONT;
        } else if (this.velocity.yUp) {
            this.currentColumnInSpriteSheet = this.columnsOnSpriteSheet.BACK;
        } else if (this.velocity.xRight) {
            this.currentColumnInSpriteSheet = this.columnsOnSpriteSheet.RIGHT;
        } else if (this.velocity.xLeft) {
            this.currentColumnInSpriteSheet = this.columnsOnSpriteSheet.LEFT;
        }
    }
}
