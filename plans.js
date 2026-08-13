// Baked-in itineraries served by view.html without needing the cloud database.
// These are always-on: the viewer loads them instantly and they never "sleep."
// Selections in the viewer stay ephemeral (nothing writes back). To change a baked
// plan's contents, edit it here and redeploy.
window.LOCAL_PLANS = {
  "april-break-330fef": {
    "title": "April Break Disney Trip",
    "items": [
      {"id":"i1785103290859633","type":"flight","title":"Bos to Orlando","cost":1393,"optional":false,"included":true,"date":"2027-04-17","group":"","endDate":"","people":0},
      {"id":"i1785103317835922","type":"flight","title":"Sarasota to Boston","cost":893,"optional":false,"included":true,"date":"2027-04-24","group":"","endDate":"","people":4},
      {"id":"i1785104172338265","type":"stay","title":"Orlando House","cost":525,"date":"2027-04-17","endDate":"2027-04-20","optional":false,"included":true,"group":"Orlando Stay","people":4},
      {"id":"i178510460441321","type":"stay","title":"Animal Kingdom","cost":12224,"date":"2027-04-17","endDate":"2027-04-20","optional":false,"included":true,"group":"Orlando Stay","people":4},
      {"id":"i1785104621509429","type":"stay","title":"Cheapest On-Prem","cost":599,"date":"2027-04-17","endDate":"2027-04-20","optional":false,"included":true,"group":"Orlando Stay","people":4},
      {"id":"i1785104639733479","type":"stay","title":"Port Orleans Riverside","cost":1175,"date":"2027-04-17","endDate":"2027-04-20","optional":false,"included":true,"group":"Orlando Stay","people":4},
      {"id":"i1785104676020251","type":"ticket","title":"1 Day Magic Kingdom","cost":943,"date":"2027-04-19","endDate":"","optional":false,"included":true,"group":"","people":4},
      {"id":"i1785104730686447","type":"ticket","title":"Discovery Cove (Dolphin Swim)","cost":1216,"date":"2027-04-20","endDate":"","optional":false,"included":true,"group":"Discovery Cove","people":4},
      {"id":"i1785104793329670","type":"other","title":"Multi-Pass","cost":180,"date":"2027-04-20","endDate":"","optional":false,"included":true,"group":"Fast Pass","people":4},
      {"id":"i1785104805647107","type":"other","title":"Premium","cost":1600,"date":"2027-04-20","endDate":"","optional":false,"included":true,"group":"Fast Pass","people":4},
      {"id":"i1785104825179843","type":"other","title":"Bibbidi Bop Salon","cost":460,"date":"2027-04-20","endDate":"","optional":true,"included":true,"group":"","people":2},
      {"id":"i1785104842670904","type":"reservation","title":"Cinderella Royal Table","cost":300,"date":"2027-04-20","endDate":"","optional":true,"included":true,"group":"","people":4},
      {"id":"i1785104888733998","type":"stay","title":"Beach House (Siesta Key)","cost":1825,"date":"2027-04-21","endDate":"2027-04-24","optional":false,"included":true,"group":"Beach House","people":4},
      {"id":"i1785104905193645","type":"stay","title":"Beach House (Anna Maria)","cost":1350,"date":"2027-04-21","endDate":"2027-04-24","optional":false,"included":true,"group":"Beach House","people":4},
      {"id":"i1785107926786309","type":"ticket","title":"Discovery Cove (Day Pass)","cost":1000,"people":4,"date":"2027-04-20","endDate":"","optional":false,"included":true,"group":"Discovery Cove"},
      {"id":"i1785108151161573","type":"car","title":"Golf Cart (3 days)","cost":400,"people":4,"date":"2027-04-21","endDate":"2027-04-24","optional":true,"included":true,"group":""},
      {"id":"i1785108326193514","type":"car","title":"Car Rental","cost":225,"people":4,"date":"2027-04-17","endDate":"2027-04-24","optional":false,"included":true,"group":""}
    ],
    "groupSel": {
      "Orlando Stay": "i1785104172338265",
      "Discovery Cove": "i1785107926786309",
      "Fast Pass": "i1785104793329670",
      "Beach House": "i1785104905193645"
    },
    "groupOff": { "Fast Pass": false, "Discovery Cove": false }
  }
};
