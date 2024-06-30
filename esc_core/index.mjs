/*
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getBlockchainGateway } from './blockchain_connect.mjs';

const gateway = {};
const contract = {};
const config = {}
const intervalCalculate = {}
const csvTimeout = {}
const csvBody = {};
const csvBodyHarvest = {};

export const ESCnumber = {
  counter: 0
};


/**
 * Configurates every variable necessary to run an esc.
 * @function
 * @param {object} configuration - The initial configuration object with the necessary variables.
 */
export function configurate(configuration, esc) {
  config[esc] = JSON.parse(JSON.stringify(configuration));
  config[esc].changeFrequency = { change: false, newFrequency: 0 };
  config[esc].data = [];
  config[esc].countCalculationsOverMax = 0;
  config[esc].calculationDates = [];
  config[esc].execTimes = [];
  config[esc].analysisHandler = 0;
  config[esc].hookDataHandler = 0;
  config[esc].flag = [];
  config[esc].analysisTime = {};
  config[esc].initialTimeCounter = 0;
  config[esc].updateDataCounter = 0;
  config[esc].timeStampInitUpdateData = {};
  config[esc].analysisFailCounter = {};
  config[esc].timeStampInitAnalysis = {};
  config[esc].analysisTransactionTimesHistory = [];

  ESCnumber.counter++;
}


/**
 * Connects to the blockchain network using the configuration variables
 * @function
 */
export async function connect(esc) {
  const block_gateway = await getBlockchainGateway(
    config[esc].conexionPath,
    config[esc].identityName
  );
  gateway[esc] = block_gateway;
  // Get the network (channel) our contract is deployed to
  const network = await gateway.getNetwork(config[esc].channelName);
  contract[esc] = network.getContract(config[esc].chaincodeName);
}


/**
 * Sets the event listener responsible for evaluating the elastic parameters periodically and adjusting the parameters accordingly.
 * @function
 */
export async function harvesterListener(esc) {
  const [controlCount, avgExecTime] = [0, 0];

  const listener = contract[esc].addContractListener(async (event) => {
    // event = JSON.parse(event.payload.toString());
    event = event.payload;

    if (event.type === 'analysis') {
      const analysisTime = (Date.now() - config[esc].timeStampInitAnalysis[event.info[0][0]]) / 1000;
      avgExecTime += analysisTime / config[esc].frequencyControlCalculate;
      controlCount++;

      if (controlCount >= config[esc].frequencyControlCalculate) {
        if (!config[esc].analysisTransactionTimesHistory[event.info[0][0]]) {
          config[esc].analysisTransactionTimesHistory[event.info[0][0]] = avgExecTime;
        }

        // Average of the last 5 analysis transactions is calculated to apply elasticity
        const lastFiveTimes = config[esc].analysisTransactionTimesHistory.slice(-config[esc].numberOfTimesForAnalysisAvg);
        const avgLastFiveTimes = lastFiveTimes.reduce((a, b) => a + b, 0) / lastFiveTimes.length;

        try {
          // Can be either timeWindow or harvestFrequency
          const isTimeWindow = config[esc].elasticityMode === "timeWindow";
          const res = JSON.parse(
            await contract[esc].evaluateTransaction(
              isTimeWindow ? config[esc].evaluateWindowTimeContract : config[esc].evaluateHarvestFrequencyContract,
              isTimeWindow ? config[esc].dataTimeLimit : config[esc].harvestFrequency,
              avgLastFiveTimes,
              config[esc].maximumTimeAnalysis,
              config[esc].minimumTimeAnalysis)
          );

          if (isTimeWindow) {
            const newTime = res < 1 ? 1 : res > 65536 ? 65536 : res; // 1 <= newTime <= 65536

            if (newTime > config[esc].harvestFrequency && newTime != config[esc].dataTimeLimit) {
              config[esc].dataTimeLimit = newTime;
              console.log("[elastic-smart-contracts] - New Time Data: " + config[esc].dataTimeLimit)
            }
          } else {
            const newTime = res < 5 ? 5 : res > 60 ? 60 : res; // 5 <= newTime <= 60

            if (newTime > 0 && newTime >= config[esc].analysisFrequency && newTime != config[esc].harvestFrequency) {
              console.log(`[elastic-smart-contracts] - ${esc}: New Harvest Frequency: ${newTime}`);
              config[esc].changeFrequency = { change: true, newFrequency: newTime }
              config[esc].harvestFrequency = newTime;
            }
          }
        } catch (err) {
          console.error(`[elastic-smart-contracts] - Error: ${err}`)
        }
        controlCount = 0;
        avgExecTime = 0;
      }
    }
  });

  setTimeout(() => {
    /**
     * TODO: Check why this was commented before
     */
    contract[esc].removeContractListener(listener);
  }, config[esc].executionTime * 1000 + 100);
}

export function updateDataListener(esc) {
  contract[esc].addContractListener((event) => {
    //event = JSON.parse(event.payload.toString());
    event = event.payload;

    const endUpdateData = Date.now();
    const updateDataTransactionTime = endUpdateData - config[esc].timeStampInitUpdateData[event.updateDataID];

    if (event.type === 'updateData') {
      csvBodyHarvest[esc] += `${config[esc].timeStampInitUpdateData[event.updateDataID]},${endUpdateData},${updateDataTransactionTime},${event.initTime},${event.endTime},${event.totalTime},${event.collectorRequestTime}\n`;
    }
  });
}


async function hookData(esc, params, check, analysisID) {
  //Check if another transaction is taking place
  if (config[esc].flag.length === 0) {
    clearInterval(check);
    //Set flag to indicate that a transaction is taking place
    if (analysisID) {
      config[esc].flag.push("analysis");
      config[esc].timeStampInitAnalysis[analysisID] = Date.now();
    } else {
      config[esc].flag.push("harvest")
      params.updateDataID = config[esc].updateDataCounter;
      config[esc].timeStampInitUpdateData[config[esc].updateDataCounter] = Date.now();
    }

    //Submit update data transaction
    try {
      await contract[esc].submitTransaction(
        analysisID ? config[esc].analysisContract : config[esc].updateDataContract,
        JSON.stringify(params)
      );
      config[esc].flag.pop();
      console.log(`[elastic-smart-contracts] - ${esc}: Data submitted to the blockchain`);
      if (!analysisID) {
        config[esc].updateDataCounter++;
      }
    } catch (err) {
      console.error(`[elastic-smart-contracts] - ${err}`);
    }
  } else {
    // Retry update data transaction submission if another transaction is taking place
    console.log(`[elastic-smart-contracts] - FAILED ${config[esc].hookDataFailCounter}`);
    analysisID ? config[esc].analysisFailCounter[analysisID]++ : config[esc].hookDataFailCounter++;
    const failCounter = analysisID ? config[esc].analysisFailCounter[analysisID] : config[esc].hookDataFailCounter;

    if (failCounter > 10) {
      clearInterval(check);
      analysisID ? config[esc].analysisFailCounter[analysisID] = 0 : config[esc].hookDataFailCounter = 0;
      console.log(`[elastic-smart-contracts] - ${esc}: Hook data transaction failed`);
    } else {
      console.log(`[elastic-smart-contracts] - ${esc}: Another transaction is currently running, retrying hook...`);
    }
  }
}

/**
 * This functions save the new data from the harvester until enough data for a batch to introduce is ready and the storage data is not currently in use
 * for analysis, then it submits the new data.
 * @function
 * @param {object} params - An object with any aditional param besides the default ones for the smart contract to use.
 * @param {object} newData - The new data to introduce in the blockchain or temporarely hold to introduce it later.
 */
export function harvesterHook(params, newData, esc) {
  try {
    config[esc].data.push(newData);
    config[esc].hookDataFailCounter = 0;

    if (config[esc].data.length >= 1) {
      let submit = config[esc].data;
      config[esc].data = [];

      params.data = JSON.stringify(submit);
      params.timeData = config[esc].dataTimeLimit;
      params.frequency = config[esc].harvestFrequency;
      params.dataPerHarvest = config[esc].dataPerHarvest;
      params.collectorRequestTime = newData.collectorRequestTime;

      let check = 0;
      check = setInterval(() => void hookData(esc, params, check), 500);
    }
  } catch (error) {
    console.error(`Failed to submit transaction: ${error}`);
  }
}

/**
 * This functions sets up a listener which recolect the analysis data and dump it into a file at the end of its execution.
 * It also calls the analysis function each time a new batch of data has been introduced in the blockchain.
 * @function
 * @param {object} params - An object with any aditional param besides the default ones for the smart contract to use.
 */
export async function analyser(params, esc) {
  try {
    csvBody[esc] = "";
    csvBodyHarvest[esc] = "";
    // let csvBodyCalculated = "";
    const resultFile = config[esc].resultsPath + "/" + config[esc].experimentName + "_" + new Date().toLocaleDateString().replace("/", "_").replace("/", "_") + ".csv";
    const resultFileHarvest = config[esc].resultsPath + "/" + config[esc].experimentName + "_" + new Date().toLocaleDateString().replace("/", "_").replace("/", "_") + "_harvest.csv";

    try {
      const data = await readFile(resultFile);
      csvBody[esc] = data;
    } catch {
      csvBody[esc] = config[esc].csvResultsCalculationsHeader;
    }

    try {
      const data = await readFile(resultFileHarvest);
      csvBodyHarvest[esc] = data;
    } catch {
      csvBodyHarvest[esc] = config[esc].csvResultsHarvestHeader;
    }

    let fromDate = Date.now();

    const listener = contract[esc].addContractListener((event) => {
      // event = JSON.parse(event.payload.toString());
      event = event.payload;

      if (event.type === 'analysis') {
        config[esc].dataTimeLimit = event.timeData;

        for (let j = 0; j < event.analysisList.length; j++) {
          if (config[esc].maximumTimeAnalysis < event.execDuration) {
            config[esc].countCalculationsOverMax++;
          }

          console.log(`[elastic-smart-contracts] - ${esc}: An analysis has been executed with a duration of ${event.execDuration} ms`);

          const end = Date.now()
          const analysisTime = (end - config[esc].timeStampInitAnalysis[event.info[0][0]]) / 1000;

          if (!config[esc].analysisTransactionTimesHistory[event.info[0][0]]) {
            config[esc].analysisTransactionTimesHistory[event.info[0][0]] = analysisTime;
          }

          // Add analysis info to the csv body
          csvBody[esc] += `${event.analysisList[j] + 1},${analysisTime},${event.execDuration / 1000},${config[esc].analysisFrequency},${event.timeData},${event.frequencyData},${event.totalDataStoredList[j]},${event.fromDates[j]},${event.fromDates[j] - (1000 * event.timeData)},${config[esc].minimumTimeAnalysis},${config[esc].maximumTimeAnalysis},${ESCnumber.counter},${config[esc].analysisFailCounter[event.info[0][0]]},${config[esc].hookDataFailCounter},${config[esc].timeStampInitAnalysis[event.info[0][0]]},${Date.now()}`;
          for (let i = 0; i < event.info.length; i++) {
            csvBody[esc] += `,${event.info[i][j]}`
          }
          if (analysisTime > 0) {
            config[esc].execTimes.push(analysisTime);
          }

          csvBody[esc] += `\n`
        }
      }
    });

    async function intAnalysis() {
      config[esc].calculationDates.push(fromDate);
      params.timeData = config[esc].dataTimeLimit;
      params.fromDates = JSON.stringify(config[esc].calculationDates);
      params.frequency = config[esc].harvestFrequency;
      console.log(`[elastic-smart-contracts] - ${esc}: Launching analysis transaction`);
      const analysisID = config[esc].initialTimeCounter;
      config[esc].initialTimeCounter++;
      await analysis(params, esc, analysisID);
      config[esc].calculationDates = [];
      if (config[esc].elasticityMode === "harvestFrequency") {
        clearInterval(intervalCalculate[esc]);
        intervalCalculate[esc] = setInterval(intAnalysis, config[esc].analysisFrequency * 1000);
      }
      fromDate += config[esc].analysisFrequency * 1000;
    }

    setTimeout(() => {
      intervalCalculate[esc] = setInterval(intAnalysis, config[esc].analysisFrequency * 1000);

      setTimeout(() => {
        clearInterval(intervalCalculate[esc]);
      }, config[esc].executionTime * 1000 + 500);

    }, config[esc].analysisStartDelay * 1000);


    csvTimeout[esc] = setTimeout(async () => {
      //contract[esc].removeContractListener(listener);
      await mkdir(dirname(resultFile), { recursive: true })
      await writeFile(resultFile, csvBody[esc], 'utf8');
      await mkdir(dirname(resultFileHarvest), { recursive: true });
      await writeFile(resultFileHarvest, csvBodyHarvest[esc], 'utf8');
    }, config[esc].executionTime * 1000 + 10000);

  } catch (error) {
    console.error(`Failed to submit transaction: ${error}`);
  }
}


/**
 * This functions calls the analysis smart contract with the params given
 * @function
 * @param {object} params - An object with any aditional param besides the default ones for the smart contract to use.
 */
async function analysis(params, esc, analysisID) {
  try {
    config[esc].analysisFailCounter[analysisID] = 0;
    const result = await contract[esc].evaluateTransaction(
      config[esc].queryAnalysisHolderContract,
      config[esc].analysisHolderId
    );
    params.analysisHolder = result.toString();
    params.analysisID = analysisID.toString();
    let check = 0;
    // Submit the specified transaction.
    check = setInterval(() => void hookData(esc, params, check, analysisID), config[esc].analysisRetryTime);

    // Disconnect from the gateway.
    //await gateway.disconnect();

  } catch (error) {
    console.error(`Failed to submit transaction: ${error}`);
  }
}

/**
 * This functions returns an object which indicates if the frequency needs to be changed and the new one in that case.
 * @function
 */
export async function getNewFrequency(esc) {
  return config[esc].changeFrequency;
}

/**
 * Once the frequency has changed this function sets the configuration parameter to not change the frequency.
  * @function
 */
export async function frequencyChanged(esc) {
  config[esc].changeFrequency = { change: false, newTime: 0 };
}
