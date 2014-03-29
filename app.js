/**
 * Nonlinear Auto-Soylent Solver v0.4
 *
 * by  Alrecenk (Matt McDaniel) of Inductive Bias LLC (http://www.inductivebias.com)
 * and Nick Poulden of DIY Soylent (http://diy.soylent.me)
 *
 */

// This can be replaced with any of the recipes on http://diy.soylent.me

var nutrientProfile = "51e4e6ca7789bc0200000007"// standard nutrient profile
var recipes = ["diy.soylent.me/recipes/optimized-top-five-remix-simplified"
/*
"diy.soylent.me/recipes/people-chow-301-tortilla-perfection"
	 ,"diy.soylent.me/recipes/quidnycs-superfood-for-him"
	 ,"diy.soylent.me/recipes/basic-complete-soylent-bachelor-chow"
	 ,"diy.soylent.me/recipes/bachelorette-chow-basic-chocolate-complete-soylent-1500-calories"
	 ,"diy.soylent.me/recipes/simplecheapvegannosoy-soylent-low-carb"
	 ,"diy.soylent.me/recipes/more-nutritious-than-batman-superman-and-the-incredible-hulk-put-together"
	 ,"diy.soylent.me/recipes/quidnycs-female-blend"
	 ,"diy.soylent.me/recipes/mens-basic-complete-nutrition-chocolate-1600"
	 ,"diy.soylent.me/recipes/simple-soylent-2"
	 ,"diy.soylent.me/recipes/quidnycs-ketofood-for-ongoing-ketosis"
	*/
	] ;
	



var ingredientLength,
    targetLength, // Length of ingredient and target array (also dimensions of m)
    M,            // Matrix mapping ingredient amounts to chemical amounts (values are fraction per serving of target value)
    cost,         // Cost of each ingredient per serving
    w = 0.07,    // Weight cost regularization (creates sparse recipes for large numbers of ingredient, use 0 for few ingredients)
    maxPerMin,    // Ratio of maximum value to taget value for each ingredient
    lowWeight,	
    highWeight,		// How to weight penalties for going over or under a requirement
	maxFractionAllowed =0.9, // recipes are penalized for going above this fraction of the maximum in the nutrient profile
	enableServingSizeCorrection = true, //when true all ingredients will be scaled so all are >= 100%
	macroWeight = 3 ; // how macro nutrients are weighted compared to micro
	maxMacroRatio = 1.1; //the maximum amount of macro nutrients allowed relative to minimum
	;   

var nutrients = [
    'biotin', 'calcium', 'calories', 'carbs', 'chloride', 'cholesterol', 'choline', 'chromium', 'copper', 'fat',
    'fiber', 'folate', 'iodine', 'iron', 'maganese', 'magnesium', 'molybdenum', 'niacin', 'omega_3', 'omega_6',
    'panthothenic', 'phosphorus', 'potassium', 'protein', 'riboflavin', 'selinium', 'sodium', 'sulfur', 'thiamin',
    'vitamin_a', 'vitamin_b12', 'vitamin_b6', 'vitamin_c', 'vitamin_d', 'vitamin_e', 'vitamin_k', 'zinc'
];

// These nutrients are considered 'more important'
var macroNutrients = ["calories", "protein", "carbs", "fat"];


/**
 * Fitness function that is being optimized
 *
 * Note: target values are assumed as 1 meaning M amounts are normalized to be fractions of target values does not
 * consider constraints, those are managed elsewhere.
 *
 * Based on the formula (M * x-1)^2 + w *(x dot c) except that penalties are only given if above max or below min and
 * quadratically from that point.
 *
 * @author Alrecenk (Matt McDaniel) of Inductive Bias LLC (www.inductivebias.com) March 2014
 */
function f(x) {

    var output = createArray(targetLength),
        totalError = 0;

    // M*x - 1
    for (var t = 0; t < targetLength; t++) {
        // Calculate output
        output[t] = 0;
        for (var i = 0; i < ingredientLength; i++) {
            output[t] += M[i][t] * x[i];
		}
        // If too low penalize with low weight
        if (output[t] < 1) {
            totalError += lowWeight[t] * (1 - output[t]) * (1 - output[t]);
        }
        else if (output[t] > maxPerMin[t]){ // If too high penalize with high weight
            totalError += highWeight[t] * (maxPerMin[t] - output[t]) * (maxPerMin[t] - output[t]);
        }
		
    }

    // Calculate cost penalty, |c*x|
    // but X is nonnegative so absolute values aren't necessarry
    var penalty = 0;
    for (var i = 0; i < ingredientLength; i++) {
        penalty += cost[i] * x[i];
    }
	
    return totalError + w * penalty;
}

/**
 * Gradient of f with respect to x.
 * Based on the formula 2 M^T(Mx-1) + wc except with separate parabolas for going over or under.
 * Does not consdier constraints, those are managed elsewhere.
 *
 * @author Alrecenk (Matt McDaniel) of Inductive Bias LLC (www.inductivebias.com) March 2014
 */
function gradient(x){

    var output = createArray(targetLength);

    // output = M*x
    for (var t = 0; t < targetLength; t++) {
        // Calculate output
        output[t] = 0;
        for (var i = 0; i < ingredientLength; i++) {
            output[t] += M[i][t] * x[i];
        }
    }

    // Initialize gradient
    var dx = [];
    for (var i = 0; i < ingredientLength; i++) {
        dx[i] = 0;
        for (var t = 0; t < targetLength; t++) {
            // M^t (error)
            if (output[t] < 1) { // If output too low calculate gradient from low parabola
                dx[i] += lowWeight[t] * M[i][t] * (output[t] - 1);
            }
            else if (output[t] > maxPerMin[t]) { // If output too high calculate gradient from high parabola
                dx[i] += highWeight[t] * M[i][t] * (output[t] - maxPerMin[t]);
            }
        }
        dx[i] += cost[i] * w; // + c w
    }
    return dx;
}

/**
 * Generates a recipe based on gradient descent minimzation of a fitness function cosisting of half parabola penalties
 * for out of range items and weighted monetary cost minimzation.
 *
 * @author Alrecenk (Matt McDaniel) of Inductive Bias LLC (www.inductivebias.com) March 2014
 */
function generateRecipe(ingredients, nutrientTargets){

	// Initialize our return object: an array of ingredient quantities (in the same order the ingredients are passed in)
	var ingredientQuantities = [], targetAmount = [], // Target amounts used to convert ingredient amounts to per serving ratios
 targetName = [], x = []; // Number of servings of each ingredient
	// Fetch the target values ignoring the "max" values and any nonnumerical variables
	for (var key in nutrientTargets) {
		var name = key, value = nutrientTargets[key];
		
		if (nutrients.indexOf(name) >= 0 && name.substring(name.length - 4, name.length) != "_max" && value > 0) {
			targetName.push(name);
			targetAmount.push(value);
		}
	}
	
	maxPerMin = [];
	lowWeight = [];
	highWeight = [];
	
	// Initialize target amount maxes and mins along with weights.
	// There are some hardcoded rules that should be made configurable in the future.
	for (var t = 0; t < targetAmount.length; t++) {
		// If has a max for this element
		if (nutrientTargets[targetName[t] + "_max"] > targetAmount[t]) {
			var maxvalue = nutrientTargets[targetName[t] + '_max'];
			maxPerMin[t] = maxFractionAllowed * maxvalue / targetAmount[t]; // Record it
		}
		else {
			maxPerMin[t] = 1000; // Max is super high for things that aren't limited
		}
		
		// Weight macro nutrients values higher and make sure we penalize for going over (ad hoc common sense rule)
		if (macroNutrients.indexOf(targetName[t]) >= 0) {
			lowWeight[t] = macroWeight;
			highWeight[t] = macroWeight;
			maxPerMin[t] = maxMacroRatio;
		}
		else {
			lowWeight[t] = 1;
			highWeight[t] = 1;
		}
		
		//console.log(targetName[t] + " : " + targetAmount[t] +" --max ratio :" + maxPerMin[t] +" weights :" + lowWeight[t]+"," + highWeight[t]);
	}
	
	// Intitialize the matrix mapping ingredients to chemicals and the cost weights.
	// These are the constants necessary to evaluate the fitness function and gradient.
	
	ingredientLength = ingredients.length;
	targetLength = targetAmount.length;
	M = createArray(ingredientLength, targetLength);
	cost = [];
	
	for (var i = 0; i < ingredients.length; i++) {
	
	
		// Cost per serving is cost per container * servings per container
		if (isNaN(ingredients[i].container_size) || ingredients[i].container_size <= 0 || isNaN(ingredients[i].serving) || ingredients[i].serving <= 0) {
			console.log("Warning: No container size specified for " + ingredients[i].name + ". Assuming same as serving size. Error possible.");
			cost[i] = ingredients[i].item_cost;
			x[i] = ingredients[i].amount;
		}
		else {
			cost[i] = ingredients[i].item_cost * ingredients[i].serving / ingredients[i].container_size;
			x[i] = ingredients[i].amount / ingredients[i].serving; // Initialize with initial recipe
			//console.log(cost[i]);
		
		}
		
		x[i] = 0 ;
		
		if (cost[i] <= 0.0000001) {
			console.log("Warning: " + ingredients[i].name + " does not have a cost. It will not be used. Error possible.");
			
			cost[i] = 123456; // give it a high cost to get it removed
		}
		
		
		if (cost[i] >= 123456) {
			x[i] = 0;
			for (var t = 0; t < targetLength; t++) {
				M[i][t] = 0;
			}
		}
		else {
		
			for (var t = 0; t < targetLength; t++) {
				// Fraction of daily value of target t in ingredient i
				if (isNaN(ingredients[i][targetName[t]])) {
					console.log("NaN in M for " + ingredients[i].name + " -> " + targetName[t]);
					M[i][t] = 0;
				}
				else {
					M[i][t] = ingredients[i][targetName[t]] / targetAmount[t];
				}
			}
		}
		
		
		
	}
	
	var pricePerDay = 0;
    for (var k = 0; k < x.length; k++) {
		pricePerDay += x[k] * cost[k];
    }
	
	console.log("Starting price per day: $" + pricePerDay.toFixed(2));
	console.log("Calculating Optimal Recipe...");
	
	var fv = f(x), g = gradient(x), iteration = 0;
	var newf;
	var newx = [];
	var done = false;
	
	
	
	while (!done && iteration < 50000) { // Loops until no improvement can be made or max iterations
		iteration++;
		
		stepsize = StepSize(x, scale(g, -1));
		done = (stepsize == 0);
		if (!done) {
			for (var i = 0; i < x.length; i++) {
				newx[i] = x[i] - g[i] * stepsize;
				if (newx[i] < 0) {
					newx[i] = 0;
				}
			}
			x = newx;
			fv = f(x);
			g = gradient(x);
		}
		
		
	}
	
	
	
	
	console.log("Optimization complete in " + iteration + " iterations.");
	//Optimization is complete at this point but because penalty methods are used 
	//(rather than barriers which cause other problems) a high weight on cost will 
	// result in a few number being slightly below 100%, so we scale the entire recipe up to make
	//the lowest element 100 %
	if (enableServingSizeCorrection) {
	
		var maxratio = 1;
		for (var t = 0; t < targetLength; t++) {
			var nutrientamount = 0;
			for (var i = 0; i < ingredientLength; i++) {
				nutrientamount += x[i] * M[i][t];
			}
			if (1.0 / nutrientamount > maxratio) {
				maxratio = 1.0 / nutrientamount;
			}
		}
		if (maxratio > 1.1) {
			console.log("Warning: Serving size correction above 10%(" + ((maxratio - 1) * 100).toFixed(2) + "%). Consider reducing cost weight.");
		}
		else {
			console.log("Recipe scaled up by " + ((maxratio - 1) * 100).toFixed(2) + "%." ) ;
		}
		for (var i = 0; i < ingredientLength; i++) {
			x[i] *= maxratio;
		}
	}
	
	

    pricePerDay = 0;
    for (var k = 0; k < x.length; k++) {
		pricePerDay += x[k] * cost[k];
    }

    console.log("Price per day: $" + pricePerDay.toFixed(2));

    // Map number of servings into raw quantities because that's what this function is supposed to return
    for (var i = 0; i < ingredients.length; i++) {
		if(isNaN(ingredients[i].serving) || ingredients[i].serving <=0){
			console.log("Warning: Serving size unlisted for " + ingredients[i].name +". Assuming 1. Error possible.")
			ingredientQuantities[i] = x[i] ;
		}else{
			ingredientQuantities[i] = x[i] * ingredients[i].serving;
		}
		//console.log(ingredientQuantities[i] + " from " + x[i] +" * " + ingredients[i].serving)
			
    }

    return ingredientQuantities;
}

// Convenience function for preinitializing arrays because I'm not accustomed to working on javascript
function createArray(length) {
    var arr = new Array(length || 0),
        i = length;

    if (arguments.length > 1) {
        var args = Array.prototype.slice.call(arguments, 1);
        while(i--) arr[length-1 - i] = createArray.apply(this, args);
    }

    return arr;
}

//given three points and their function values this fits a polynomial
//and returns the x value of its minimum

function parabolicInterpolation( x1, fx1, x2, fx2, x3, fx3){
	var left = (x2-x1) * (fx2-fx3) ;
	var right = (x2-x3)* (fx2-fx1) ;
	var top = (x2-x1)*left - (x2-x3)*right ;
	var bottom = 2 * ( left- right) ;
	return x2 - top/bottom ;
}
	
	//get a good step size when at x with step diorection g
	//returns multiple of g you should move in
	function StepSize( x, g){
		
	var fv = f(x) ;
	var newf ;
	var newx = [] ;
	var stepsize = 2; // Start with big step
 	var linesearch = true;
	var done = false ;
	while (linesearch) {
		newx = [] ;
		// Calculate new potential value
		for (var i = 0; i < x.length; i++) {
			newx[i] = x[i] + g[i] * stepsize;
			if (newx[i] < 0) {
				newx[i] = 0;
			}
		}
		newf = f(newx); // Get fitness
		if (newf < fv) { // If improvement then accept and recalculate gradient
			linesearch = false; // exit line search
		}
		else {
			stepsize *= 0.5; // If bad then halve step size
			if (stepsize < 0.000000000001) { // If stepsize too small then quit search entirely
				done = true;
				linesearch = false;
			}
			else { // otherwise continue line search
				linesearch = true;
			}
		}
	}
	if(done){
		return 0 ;
	}else{
		//check the mid point
		var midx = [] ;
		for(var k=0;k<x.length;k++){
			midx[k] = x[k] + g[k]*stepsize/2.0 ;
			if(midx[k]<0){
				midx[k] = 0 ;
			}
		}
		var midf = f(midx) ;
		//use those 3 points to construct an approximate parabola and try its minimum
		var opt = parabolicInterpolation(0,fv,.5,midf,1,newf) ;
		var optx = [] ;
		for(var k=0;k<x.length;k++){
			optx[k] = x[k] + g[k]*stepsize*opt ;
			if(optx[k]<0){
				optx[k] = 0 ;
			}
		}
		var optf = f(optx) ;
		//keep whichever new point is best
		//console.log( fv +", " + newf +", " + midf +", " + optf) ;
		//we already know new f is less than first f
		fv = newf;
		//if the mid point was better then keep it
		if (midf < fv) {
			fv = midf;
			return stepsize*0.5 ; 
		}
		//if the parabolic interpolation was better then keep it
		if (optf < fv) {
			return opt*stepsize
		}
		
		return stepsize ;
	}
		
		
}
	
	function dot(a,b){
		var dot = 0 ;
		for(var k=0;k<a.length;k++){
			dot+=a[k]*b[k] ;
		}
		return dot ;
	}
	
	//returns a vector = to a*s
	function scale(a, s)
	{
		var  b = [];
		for (var k = 0; k < a.length; k++)
		{
			b[k] = a[k] * s;
		}
		return b;
	}
	//returns the sum of two vectors
	function add( a, b)
	{
		var  c = [];
		for (var k = 0; k < a.length; k++)
		{
			c[k] = a[k] + b[k];
		}
		return c;
	}
	//returns the difference of two vectors = a-b
	function subtract( a,  b)
	{
		var c = [];
		for (var k = 0; k < a.length; k++)
		{
			c[k] = a[k] - b[k];
		}
		return c;
	}
	
	//returns the euclidean length of a vector
	function length(a)
	{
		return Math.sqrt(dot(a, a));
	}

	//the two norm is just the squareroot of the dot product, same as length
	function norm(a)
	{
		return length(a);
	}



// Fetch recipe, pass to generateRecipe function and output results...
var completions = 0;
var request = require('superagent'), // Library to request recipe from diy.soylent.me
Table = require('cli-table'),    // Library to output the results in a pretty way
colors = require('colors');

console.log("\nFetching recipes from the DIY Soylent website...");
var ingredients = [] ;
var nutrientTargets ;

var recipeingredients = [] ;

for( var i=0; i < recipes.length; i++){
	request.get(recipes[i] + "/json?nutrientProfile=" + nutrientProfile, function(err, response){
		if (err) {
			console.log("An error occurred", err);
		
			
		//return;
		}
		else {
			//console.log("Adding Ingredients\n");
			recipeingredients.push(response.body.ingredients)
			//check if already in ingredient list
			
			
			//ingredients = ingredients.concat(response.body.ingredients) ;
			nutrientTargets = response.body.nutrientTargets;
			console.log("Successfully fetched recipe.\n");
			complete();
		}
	});
	
}
	

function complete(){	
	completions++;
if (completions >= recipes.length) {
	
	//merghe all of the recipes into a single list
	for (var i = 0; i < recipes.length; i++) {
		var newingredients = recipeingredients[i];
		for (var k = 0; k < newingredients.length; k++) {
			var found = false;
			for (var j = 0; j < ingredients.length && !found; j++) {
				//console.log( j  +" - " + ingredients.length) ;
				if (newingredients[k].name == ingredients[j].name) {
					found = true; // add amount if found
					ingredients[j].amount += newingredients[k].amount;
				}
			}
			//console.log(found) ;
			//add to list if not found
			if (!found) {
				ingredients.push(newingredients[k]);
			}
		}
	}
	
	//normalize summed up recipes
	for (var j = 0; j < ingredients.length; j++) {
		ingredients[j].amount /= completions;
	}
	
	
	var i, j, nutrient;
	// Here's where the magic happens...
	var ingredientQuantities = generateRecipe(ingredients, nutrientTargets);
	
	// Now lets output the results. First the ingredients.
	var ingredientsTable = new Table({
		style: {
			compact: true
		},
		head: ["Ingredient", "Official\nAmount", "Optimized\nAmount"]
	});
	
	for (i = 0; i < ingredients.length; i++) {
		ingredientsTable.push([ingredients[i].name, ingredients[i].amount + " " + ingredients[i].unit, ingredientQuantities[i].toFixed(2) + " " + ingredients[i].unit]);
	}
	
	console.log(ingredientsTable.toString());
	
	
	// Output the nutrients.
	var nutrientsTable = new Table({
		style: {
			compact: true
		},
		head: ['Nutrient', 'Target', 'Max', 'Recipe', '% of Target']
	});
	
	// Loops over each nutrient in the target list
	for (nutrient in nutrientTargets) {
		if (nutrients.indexOf(nutrient) < 0) 
			continue; // Skip over non-nutrient properties
		// Add up the amount of the current nutrient in each of the ingredients.
		var nutrientInIngredients = 0;
		for (j = 0; j < ingredients.length; j++) {
			if (typeof ingredients[j][nutrient] == 'number') {
				if (ingredients[j].serving > 0) {
					nutrientInIngredients += ingredients[j][nutrient] * ingredientQuantities[j] / ingredients[j].serving;
				}
				else {
					//if serving size unlisted then assume it's 1
					nutrientInIngredients += ingredients[j][nutrient] * ingredientQuantities[j];
				}
			}
		}
		
		// Format percentages nicely. Cyan: too little. Green: just right. Red: too much
		var pct = (nutrientInIngredients / nutrientTargets[nutrient] * 100);
		if (pct < 99) {
			pct = pct.toFixed(0).cyan.bold;
		}
		else 
			if (nutrientTargets[nutrient + '_max'] > 0 && nutrientInIngredients > nutrientTargets[nutrient + '_max']) {
				pct = pct.toFixed(0).red.bold.inverse;
			}
			else {
				pct = pct.toFixed(0).green;
			}
		
		nutrientsTable.push([nutrient || '', // Nutrient Name
 nutrientTargets[nutrient] || '', // Target amount
 nutrientTargets[nutrient + '_max'] || '', // Maximum amount
 nutrientInIngredients.toFixed(2) || '', // Amount in Recipe
 pct || '' // % of Target in recipe
]);
	}
	
	console.log(nutrientsTable.toString());
}
}