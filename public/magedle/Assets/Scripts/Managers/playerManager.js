class PlayerManager {
    intelligence = {
        base: 15,
        value: 0
    };

    spellCastRate = {
        base: 0,
        value: 0
    };

    magicCrit = {
        base: 0,
        value: 0
    };

    movementSpeed = 5;

    goldCoinsAmount = 0;

    currentLevel = 1;
    currentExpPoints = 0;
    maxExpPoints = 100;

    equipped = {
        weapon: undefined,
        robe: undefined,
        hat: undefined,
        accessory: undefined,
    }


    constructor() {
        console.log("Player-Manager created!")
    }

    pickUpItem(item) {
        if (item.name === 'goldcoin') {
            this.goldCoinsAmount++;
            if (uiManager.currentPage === undefined) {
                uiManager.initializePage();
            }
        } else {
            playerManager.equipItem(item.name.split(':')[0], item.name.split(':')[1])
        }
    }

    recalculateStats() {
        this.calculateStat("intelligence");
        this.calculateStat("spellCastRate");
        this.calculateStat("magicCrit");
    }

    calculateStat(statName) {
        let additionForCurrentLevel = 0;
        switch (statName) {
            case "intelligence":
                additionForCurrentLevel = this.currentLevel * 3;
                break;
            case "spellCastRate":
                additionForCurrentLevel = this.currentLevel * 5;
                break;
            case "magicCrit":
                additionForCurrentLevel = this.currentLevel * 0.1;
                break;
        }
        this[statName].value = this[statName].base + additionForCurrentLevel;
        if (this.equipped.weapon !== undefined) {
            this[statName].value += this.equipped.weapon[statName];
        }
        if (this.equipped.robe !== undefined) {
            this[statName].value += this.equipped.robe[statName];
        }
        if (this.equipped.hat !== undefined) {
            this[statName].value += this.equipped.hat[statName];
        }
        if (this.equipped.accessory !== undefined) {
            this[statName].value += this.equipped.accessory[statName];
        }
    }

    equipItem(itemType, itemName) {
        this.equipped[itemType] = items[itemType][itemName];
        gameManager.playSoundEffect("EquipItem.mp3", 0.1);
        let equipSound = new Audio("./Audio/EquipItem.mp3");
        equipSound.volume = 0.5;
        equipSound.play();

        uiManager.initializePage();
    }

    getIntelligence() {
        return this.intelligence.value;
    }

    getSpellCastRate() {
        return 600 - this.spellCastRate.value;
    }

    getSpellCastRateToDisplay() {
        return this.spellCastRate.value;
    }

    getMagicCrit() {
        return this.magicCrit.value;
    }

    gainExperience(amountOfExpPoints) {
        this.currentExpPoints += amountOfExpPoints;
        if (this.currentExpPoints >= this.maxExpPoints) {
            this.currentExpPoints = 0;
            this.maxExpPoints += 20;
            this.currentLevel++;
            uiManager.initializePage();
        }
    }
}