import Axios from "axios";
import { contract, initializationState } from "./mocks";

export async function simulateLiveTx(
  inputTxId: string,
  vscApi = "https://api.vsc.eco:443"
) {
  const OUTPUT_TX_GQL = `
      query MyQuery($inputTxId: String) {
        contractStateDiff(id: $inputTxId){
          previousContractStateId
        }
      }
    `;
  const STATE_GQL = `
        query MyQuery($outputTxId: String) {
          contractState(id: $outputTxId){
            state
          }
        }
    `;
  const INPUT_PAYLOAD_GQL = `
        query MyQuery($inputTxId: String) {
          findTransaction(filterOptions: {byId: $inputTxId}) {
            txs {
              data {
                action
                payload
              }
            }
          }
        }
    `;

  const dataOutputFetch = await Axios.post(`${vscApi}/api/v1/graphql`, {
    query: OUTPUT_TX_GQL,
    variables: {
      inputTxId: inputTxId,
    },
  });
  const outputTxId =
    dataOutputFetch.data.data.contractStateDiff.previousContractStateId;

  const dataOutputState = await Axios.post(`${vscApi}/api/v1/graphql`, {
    query: STATE_GQL,
    variables: {
      outputTxId: outputTxId,
    },
  });
  const state = dataOutputState.data.data.contractState.state;
  for (let key in state) {
    initializationState.set(key, state[key]);
  }

  const inputDataFetch = await Axios.post(`${vscApi}/api/v1/graphql`, {
    query: INPUT_PAYLOAD_GQL,
    variables: {
      inputTxId: inputTxId,
    },
  });
  const data = inputDataFetch.data.data.findTransaction.txs[0].data;
  const inputData = JSON.stringify(data.payload);
  const action = data.action;

  contract[action](inputData);
}
