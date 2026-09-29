// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

enum Decision {
    Deny,
    Allow,
    Review,
    Invalid
}

enum PolicyError {
    None,
    NetlistMismatch,
    StepReverted,
    StateMismatch,
    OutputMalformed
}

struct PolicyEvaluation {
    Decision decision;
    uint8 outputs;
    PolicyError error;
}

interface IPolicyAdapter {
    function evaluate(uint8 inputs) external view returns (PolicyEvaluation memory);

    function health()
        external
        view
        returns (
            bool healthy,
            bytes32 currentNetlistHash,
            uint32 nIn,
            uint32 nOut,
            uint32 nState,
            uint32 gateCount
        );
}
