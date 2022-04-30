# omegga-deathevents

A set of events to help with death and respawning

## Install

`omegga install gh:Aware/omegga-deathevents`


## Types

| Types                          |                                                                  |
| ------------------------------ | -----------------------------------------------------------------|
| `Player`                       | { name: string, id: string, controller: string , state: string } |

## Events


| Method             | Return Type                          |
| ------------------ | -------------------------------------|
| `death`            | { player: Player, pawn: string}      |
| `spawn`            | { player: Player, pawn: string}      |

## Sample plugin

https://github.com/mraware/omegga-sample-deathevents
