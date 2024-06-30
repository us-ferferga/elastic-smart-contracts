
import { configurate, frequencyChanged, getNewFrequency, connect, analyser, harvesterListener, harvesterHook } from '../esc_core/index.mjs';
import yargs from 'yargs';

export const config = {
  conexionPath: "./network/organizations/peerOrganizations/org1.example.com/connection-org1.json",
  resultsPath: "./esc-template/results",
  identityName: "admin",
  channelName: "escchannel",
  chaincodeName: "analytics_chaincode",
  csvResultsCalculationsHeader: "NUMBER_DETECTIONS,TOTAL_TIME,FREQUENCY,TIME_DATA,FREQUENCY_DATA,DETECTIONS_STORED,FROM_DATE,TO_DATE,MINIMUM_TIME,MAXIMUM_TIME,CARS_PER_SECOND_BY_SENSOR,CARS_PER_SECOND_TOTAL\n",
  csvResultsExperimentHeader: "FREQUENCY,TIME_DATA,MIN_TIME,MAX_TIME,AVG_TIME,STD_TIME,SUCCESFUL_CALCULATIONS,CALCULATIONS_OVER_MAX\n",
  csvResultsHarvestHeader: "INIT_TIME,FINAL_TIME,TOTAL_TIME,INIT_UPDATE_TIME,FINAL_UPDATE_TIME,TOTAL_UPDATE_TIME,COLLECTOR_TIME,\n",
  executionTime: 60,
  analysisFrequency: 5,
  harvestFrequency: 1,
  analysisStartDelay: 15,
  harvestStartDelay: 0,
  dataTimeLimit: 30,
  frequencyControlCalculate: 5,
  maximumTimeAnalysis: 100,
  minimumTimeAnalysis: 50,
  elasticityMode: "timeWindow",
  experimentName: "test",
  coldStart: false,
  numberOfESCs: 1,
  dataPerHarvest: 1,
  analysisRetryTime: 500,
  numberOfTimesForAnalysisAvg: 5,
  updateDataContract: "updateData",
  evaluateHistoryContract: "evaluateHistory",
  evaluateFrequencyContract: "evaluateFrequency",
  queryAnalysisHolderContract: "queryAnalysis",
  analysisHolderId: 1,
  analysisContract: "analysis",
  dataStorageContract: "createSensor",
  calculationStorageContract: "calculationStorage"
}

export const chaincodeName = config.chaincodeName;

const harvesterHookParams = {
  // hook params
}

const analyserParams = {
 // analyser params
}

// New data to be introduced, define here how the data is collected 
function hookData(){
  let newData = {}
  return newData;
}

const argv = yargs
  .command('start', 'start the esc', {})
  .help()
  .alias('help', 'h')
  .argv; 

/**
 * Call the harvester in esc_core/index regularly with the frequency given and in case of having an elastic frequency it monitors any changes in it and applies it. 
 * 
 * In this function it is defined from where and how the data is taken to introduce it in the blockchain.
 * @function
 * @param {number} frequency - The initial frequency in seconds to harvest data.
 */
async function intervalHarvester(frequency) {
  if(config.elasticityMode === "harvestFrequency"){
    await frequencyChanged(chaincodeName);
    let interval = setInterval(async () => {
      const res = await getNewFrequency(chaincodeName);
      if (res.change) {
        clearInterval(interval);

        if (!stop) {
          intervalHarvester(res.newFrequency)
        }
      } else {
        harvesterHook(harvesterHookParams, hookData());
      }
      
    }, frequency*1000);
  } else {
    const interval = setInterval(() => harvesterHook(harvesterHookParams, hookData()), frequency*1000);
  
    setTimeout(() => {
      clearInterval(interval);
      console.log("[elastic-smart-contracts] - ************** EXECUTION COMPLETED, SHUTING DOWN ********************")
    }, config.executionTime*1000 + 100);
  }

}

if (argv._.includes('start')) {
  configurate(config)
  let stop = false;
  await connect(chaincodeName);
  await analyser(analyserParams, chaincodeName);
  await harvesterListener(chaincodeName);
  await intervalHarvester(config.harvestFrequency);
  
  if(config.elasticityMode === "harvestFrequency") {
    setTimeout(() => {
      stop = true;
      console.log("[elastic-smart-contracts] - ************** EXECUTION COMPLETED, SHUTING DOWN ********************")
    }, config.executionTime*1000 + 100);
  }
}
