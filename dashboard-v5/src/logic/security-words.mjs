// Security space - the generator's word list: short, common English words (an invented list, not copied from any published
// word list). Every word is lower-case, 3 to 8 letters, and appears once; security-generate.test.mjs pins all three and the size.
// A passphrase of N words drawn uniformly from this list carries N * log2(WORDS.length) bits, which the generator reports.
const TEXT = `
able acid acorn acre actor adapt adult agent agree ahead aid aim air aisle alarm album alert alike alive
allow alloy alone along alpha amber ample angel anger angle ankle apple apply april apron arc area arena
argue arise army aroma array arrow art ash aside atlas atom attic audio aunt autumn avoid awake award aware
axis baby back bacon badge bag bake baker balance bald ball bamboo banana band bank bar barn base basic
basil basin basket bath beach beam bean bear beard beat beauty bed bee beef beer begin bell belt bench berry
best bike bill bird birth bison bit black blade blank blast blaze bleak blend bless blind block blond blood
bloom blue blunt board boat body boil bold bolt bone bonus book boot border boss both bottle bound bowl box
brain brake branch brand brass brave bread break brick bride brief bright bring broad brook broom brown
brush bubble bucket build bulb bull bump bunch burn burst bus bush busy butter button buy buzz cabin cable
cactus cake calm camel camera camp canal candle candy cane canoe canvas canyon cap cape car card care cargo
carpet carrot carry cart case cash castle cat catch cause cave cedar ceiling cell cellar cement center chain
chair chalk champ chance change chaos chapel charm chart chase cheap check cheek cheer cheese cherry chess
chest chew chief child chill chimney chin chip choice choir chord chorus cider cigar circle city civil claim
clam clap class clay clean clear clerk click cliff climb clip clock close cloth cloud clown club clue coach
coal coast coat cobra cocoa code coffee coil coin cold collar colony color comb comet comic coral cord core
cork corn corner cost cotton couch cough count court cover cow crab craft crane crash crate crazy cream
creek crew cricket crisp crop cross crowd crown crumb crush crust cry crystal cube cup curl curry curve
cycle daily dairy daisy dance dare dark dart dash data date dawn day deal dear debt deck deer delay delta
den depth desert desk dial diary dice diet dig dime dinner dirt dish ditch dive dock doctor dog doll dome
donor door dose dove down dozen draft dragon drain drama draw dream dress drift drill drink drive drop drum
duck dune dust duty eagle ear earth ease east easy echo edge editor eel egg eight elbow elder elf elk elm
email ember empty end enemy energy engine enjoy enter entry envoy epic equal error essay even event ever
exact exam exit extra eye fable face fact fade fair fairy faith fall false fame fan farm fast fate fault
feast fee feed feel fence fern ferry fever few fiber field fig fight file film final find fine finger fire
firm fish fist five fix flag flame flash flask flat flax fleet flesh flight flint float flock flood floor
flour flow flower fluid flute fly foam focus fog foil fold folk food fool foot force forest forge fork form
fort fossil fox frame free fresh friend frog front frost fruit fuel full fun fungus funny fur fuzzy gadget
gain galaxy gale game gap garage garden garlic gas gate gear gem ghost giant gift ginger giraffe girl give
glad glass glide globe gloom glove glow glue goal goat gold golf good goose gown grace grade grain grand
grant grape graph grass gravel gravy gray great green greet grid grill grin grip groom group grove grow
guard guess guest guide guitar gulf gull gum gym habit hair half hall hammer hand happy harbor hard harp hat
hawk hay hazel head heart heat heavy hedge heel hello helmet help hen herb herd hero hike hill hint hip hive
hobby hold hole holly home honey hood hook hope horn horse host hotel hour house hover hub hug human humor
hunt hurry hut ice icon idea igloo image inch index ink inn insect iron island ivory ivy jacket jade jam jar
jaw jazz jelly jet jewel job join joke journey joy judge juice jump jungle junior jury kayak keen keep
kettle key kick kid kind king kiss kit kite kitten kiwi knee knife knit knob knot koala lab label lace
ladder lake lamb lamp land lane lantern lap laser latch laugh lava lawn layer lazy leaf lean leap learn
lease leather leg lemon lend lens leopard lesson letter level lever library lid life lift light lily lime
line linen lion lip list liter little liver lizard load loaf lobby local lock lodge log lonely long look
loop lotus loud love low luck lumber lunch lung lute lynx magic magnet maid mail main maize major make mall
mango manor maple marble march margin mark market mask mast match maze meadow meal meat medal melon melt
memo mend menu mercy merge merry mesh metal meter mice middle mild mile milk mill mind mine mint minute
mirror mist mitten mix moat model moist mole moment money monk month moon moose moss moth motor mound mouse
mouth movie mud mug mule music nail name nap navy neat neck needle nerve nest net never news nice night nine
noble nod noise noodle noon north nose note novel nurse nut oak oar oasis oat ocean olive onion open opera
orange orbit orchid order organ otter ounce oval oven owl owner oxygen oyster pace pack paddle page pail
paint pair palace palm pan panda panel panic paper parade parcel park parrot party pass pasta paste patch
path pause paw peace peach peak pear pearl pebble pecan pedal peel pen pencil penny pepper perch pet piano
pick picnic pie piece pig pigeon pile pillow pilot pin pine pink pipe pirate pitch pizza place plain plan
plane planet plank plant plate play plaza plot plow plum plume plush pocket poem poet point polar pole
police polo pond pony pool poppy porch port post pot pouch powder power prawn press price pride prime print
prism prize proof proud pulse pump pupil puppy pure purple purse puzzle quail quake queen quest quick quiet
quilt quiz rabbit raccoon race rack radar radio raft rail rain raise rake ramp ranch range rapid raven razor
reach read ready realm reef relax relay remedy rent reply rest rhyme rib ribbon rice rich ride ridge rifle
right ring rinse ripe river road roast robe robin robot rock rocket rod roll roof room root rope rose rough
round route row royal rubber ruby rug rule rumor run rush rust saddle sage sail salad salmon salt sand
sandal satin sauce sauna saw scale scarf scene scent school scoop scout screen screw sea seal season seat
second seed seek sell send sense serve seven shade shadow shake shallow shape share shark sharp shed sheep
sheet shelf shell shield shift shine ship shirt shoe shop shore short shoulder shout shovel show shrimp
shrub shy sick side sight sign silent silk silver simple sing sink sister six size skate sketch ski skill
skin skirt skull sky slab slate sled sleep sleeve slice slide slope slow small smart smell smile smoke
smooth snack snail snake snow soap sock sofa soft soil solar solid song soon sound soup south space spade
spare spark speak speed spell spice spider spike spin spine spiral spoon sport spot spray spring spruce spy
square squid squirrel stable staff stage stair stamp stand star start state steam steel stem step stew stick
stiff still sting stir stock stone stool stop store storm story stove straw stream street stripe strong
studio study stuff stump style sugar suit summer sun sunny super supper swamp swan swap sweet swim swing
sword syrup table tackle tail tailor talent talk tall tame tank tape target task taste tea teach team tear
teeth tempo ten tennis tent term test text thank theme thick thin thing think thorn thread three throne
thumb thunder ticket tide tidy tie tiger tile timber time tin tiny tip tire title toad toast today toe token
tomato tone tongue tool tooth top topic torch tornado tortoise total touch tour towel tower town toy trace
track trade trail train trap tray treat tree trend trial tribe trick trim trip trophy trout truck true
trumpet trunk trust truth tub tulip tuna tune tunnel turkey turn turtle twelve twig twin twist two uncle
under unit upper urban urge use useful usual vacuum valid valley value van vanilla vase vast vault veil
velvet venture verb verse vessel vest video view vigor village vine violin visit vital vivid voice volcano
vote voyage wafer wage wagon waist walk wall walnut waltz wand warm warn wash wasp watch water wave wax way
weak wealth wear weasel weather web wedding week weigh well west whale wheat wheel whip whisk white wide
width wife wild willow win wind window wine wing winter wire wise wish witch wolf woman wonder wood wool
word work world worm wrap wrist write yacht yard yarn year yellow yield yoga yogurt young youth zebra zero
zest zinc zone zoo
`;

export const WORDS = Object.freeze(TEXT.split(/\s+/).filter(Boolean));
