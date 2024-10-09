import { initializationState } from "./mocks";

async function TMPsimulateLiveTx(
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

  const fetchGraphQL = async (query: any, variables: any) => {
    const response = await fetch(`${vscApi}/api/v1/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });
    if (!response.ok) {
      throw new Error(`GraphQL query failed: ${response.statusText}`);
    }
    const json = await response.json();
    return json;
  };

  // Fetch output transaction data
  const dataOutputFetch = await fetchGraphQL(OUTPUT_TX_GQL, { inputTxId });
  const outputTxId =
    dataOutputFetch.data.contractStateDiff.previousContractStateId;

  // Fetch contract state
  const dataOutputState = await fetchGraphQL(STATE_GQL, { outputTxId });
  const state = dataOutputState.data.contractState.state;

  for (let key in state) {
    initializationState.set(key, state[key]);
  }

  // Fetch input transaction data
  const inputDataFetch = await fetchGraphQL(INPUT_PAYLOAD_GQL, { inputTxId });
  const data = inputDataFetch.data.findTransaction.txs[0].data;
  const inputData = JSON.stringify(data.payload);
  const action = data.action;

  console.log("action", action);
  console.log("inputData", inputData);
  console.log("initializationState", initializationState);

  // contract[action](inputData);
}
